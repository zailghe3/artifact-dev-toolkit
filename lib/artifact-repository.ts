import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { DEFAULT_ARTIFACT_BRANCH, DEFAULT_ARTIFACT_ROOT, parseArtifactMarkdown, trimSlashes, validateArtifactPath, validateUniqueArtifactIds, type ArtifactModel } from "./artifact-contract.ts";
import type { RepositoryAccessContext } from "./repository-authorization.ts";

const artifactsDir = path.join(process.cwd(), "artifacts");
const githubApiBaseUrl = "https://api.github.com";
const githubMaxBlobBytes = 1024 * 1024;
const defaultGitHubArtifactBranch = DEFAULT_ARTIFACT_BRANCH;
const defaultGitHubArtifactRoot = DEFAULT_ARTIFACT_ROOT;

export type Artifact = ArtifactModel;
export type ArtifactStatus = z.infer<typeof import("./artifact-schemas.ts").artifactStatusSchema>;

export type CreateVariationInput = {
  source: Artifact;
  body: string;
  title?: string;
};

export interface ArtifactRepository {
  list(): Promise<Artifact[]>;
  findById(id: string): Promise<Artifact | undefined>;
  createVariation(input: CreateVariationInput): Promise<string>;
}

type GitHubTreeEntry = {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
  size?: number;
  url?: string;
};

type GitHubTreeResponse = {
  tree?: GitHubTreeEntry[];
  truncated?: boolean;
};

type GitHubBlobResponse = {
  content?: string;
  encoding?: string;
  size?: number;
};

export type GitHubArtifactRepositoryConfig = {
  owner: string;
  repo: string;
  credentialProvider: () => Promise<string>;
  branch?: string;
  rootPath?: string;
  fetch?: typeof fetch;
};

const secretPatterns = [
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i,
  /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}_[A-Za-z0-9_]{59,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
];

function assertNoSecrets(value: string) {
  if (secretPatterns.some((pattern) => pattern.test(value))) {
    throw new Error("Refusing to persist content that looks like a secret or API key.");
  }
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return walkMarkdownFiles(fullPath);
        if (entry.isFile() && entry.name.endsWith(".md")) return [fullPath];
        return [];
      }),
    );
    return nested.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);
}

export class FileArtifactRepository implements ArtifactRepository {
  private readonly rootDir: string;

  constructor(rootDir = artifactsDir) {
    this.rootDir = rootDir;
  }

  async list(): Promise<Artifact[]> {
    const files = await walkMarkdownFiles(this.rootDir);
    const artifacts = await Promise.all(
      files.map(async (file) => {
        const raw = await fs.readFile(file, "utf8");
        const displayPath = path.relative(process.cwd(), file).split(path.sep).join("/");
        const pathError = validateArtifactPath(displayPath);
        if (pathError) throw new Error(`${displayPath}: ${pathError}`);
        return parseArtifactMarkdown(raw, displayPath);
      }),
    );

    validateUniqueArtifactIds(artifacts);
    return artifacts.sort((a, b) => a.title.localeCompare(b.title));
  }

  async findById(id: string) {
    const artifacts = await this.list();
    return artifacts.find((artifact) => artifact.id === id);
  }

  async createVariation({ source, body, title }: CreateVariationInput) {
    assertNoSecrets(body);
    assertNoSecrets(title ?? "");

    const timestamp = new Date().toISOString();
    const idBase = slugify(title || `${source.id} variation`);
    const id = `${idBase}-${timestamp.slice(0, 10)}-${timestamp.slice(11, 19).replace(/:/g, "")}`;
    const filePath = path.join(this.rootDir, "variations", `${id}.md`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const markdown = matter.stringify(`${body.trim()}\n`, {
      id,
      title: title?.trim() || `${source.title} Variation`,
      type: source.type,
      status: "draft",
      tags: Array.from(new Set([...source.tags, "variation"])),
      aliases: source.aliases,
      sourceId: source.id,
      createdAt: timestamp,
    });

    assertNoSecrets(markdown);
    await fs.writeFile(filePath, markdown, "utf8");
    return id;
  }
}


export type ArtifactRepositoryBackend = "file" | "github";
export class ArtifactRepositoryConfigurationError extends Error {}
export class ArtifactRepositoryUnavailableError extends Error {
  readonly status?: number;
  constructor(status?: number) { super("The artifact repository is temporarily unavailable."); this.status = status; }
}
export class ArtifactRepositoryAccessError extends Error { constructor() { super("Artifact repository access is denied."); } }
export class ArtifactRepositoryContentError extends Error { constructor() { super("The artifact repository contains invalid content."); } }

export function getArtifactRepositoryBackend(env = process.env): ArtifactRepositoryBackend {
  const value = env.ARTIFACT_REPOSITORY;
  if (value === "github") return value;
  if (value === "file" && env.NODE_ENV !== "production") return value;
  if (value === "file") throw new ArtifactRepositoryConfigurationError("ARTIFACT_REPOSITORY=file is not supported in production.");
  if (!value && env.NODE_ENV !== "production") return "file";
  throw new ArtifactRepositoryConfigurationError(value ? `Unsupported ARTIFACT_REPOSITORY value: ${value}` : "ARTIFACT_REPOSITORY is required in production.");
}

export class GitHubArtifactRepository implements ArtifactRepository {
  private readonly branch: string;
  private readonly rootPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly config: GitHubArtifactRepositoryConfig;

  constructor(config: GitHubArtifactRepositoryConfig) {
    this.config = config;
    this.branch = config.branch ?? defaultGitHubArtifactBranch;
    this.rootPath = trimSlashes(config.rootPath ?? defaultGitHubArtifactRoot);
    this.fetchImpl = config.fetch ?? fetch;
  }

  async list(): Promise<Artifact[]> {
    const tree = await this.fetchTree();
    const prefix = this.rootPath.length > 0 ? `${this.rootPath}/` : "";
    const files = tree
      .filter((entry) => entry.type === "blob" && typeof entry.path === "string" && entry.path.startsWith(prefix) && entry.path.endsWith(".md"))
      .sort((a, b) => a.path!.localeCompare(b.path!));
    console.info(JSON.stringify({ event: "github_artifact_tree_loaded", backend: "github", owner: this.config.owner, repository: this.config.repo, branch: this.branch, rootPath: this.rootPath, treeEntryCount: tree.length, markdownFileCount: files.length }));

    for (const file of files) {
      const pathError = validateArtifactPath(file.path!, this.rootPath);
      if (pathError) throw new Error(`${file.path}: ${pathError}`);
    }

    const artifacts = await Promise.all(
      files.map(async (file) => {
        if (!file.sha) throw new Error(`${file.path}: GitHub tree entry is missing a blob SHA.`);
        const raw = await this.fetchBlob(file.sha, file.path!);
        return parseArtifactMarkdown(raw, file.path!);
      }),
    );

    validateUniqueArtifactIds(artifacts);
    console.info(JSON.stringify({ event: "github_artifacts_loaded", backend: "github", owner: this.config.owner, repository: this.config.repo, parsedArtifactCount: artifacts.length }));
    return artifacts.sort((a, b) => a.title.localeCompare(b.title));
  }

  async findById(id: string): Promise<Artifact | undefined> {
    const artifacts = await this.list();
    return artifacts.find((artifact) => artifact.id === id);
  }

  async createVariation(input: CreateVariationInput): Promise<string> {
    assertNoSecrets(input.body);
    assertNoSecrets(input.title ?? "");
    throw new Error("GitHubArtifactRepository is read-only. Creating or editing artifacts is outside the DATA-002 scope.");
  }

  private githubUrl(pathname: string) {
    return `${githubApiBaseUrl}/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}${pathname}`;
  }

  private async githubJson<T>(url: string): Promise<T> {
    let credential: string;
    try {
      credential = await this.config.credentialProvider();
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 429 || (typeof status === "number" && status >= 500) || status === undefined) throw new ArtifactRepositoryUnavailableError(status);
      if (status === 401 || status === 403 || status === 404) throw new ArtifactRepositoryAccessError();
      throw new ArtifactRepositoryConfigurationError("Installation credential could not be created.");
    }
    const response = await this.fetchImpl(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${credential}`,
        "user-agent": "artifact-dev-toolkit",
        "x-github-api-version": "2022-11-28",
      },
    });

    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) throw new ArtifactRepositoryUnavailableError(response.status);
      if (response.status === 401 || response.status === 403) throw new ArtifactRepositoryAccessError();
      throw new ArtifactRepositoryContentError();
    }

    return response.json() as Promise<T>;
  }

  private async fetchTree() {
    const tree = await this.githubJson<GitHubTreeResponse>(this.githubUrl(`/git/trees/${encodeURIComponent(this.branch)}?recursive=1`));
    if (!Array.isArray(tree.tree)) throw new Error("GitHub artifact repository tree response was malformed.");
    if (tree.truncated) throw new Error("GitHub artifact repository tree response was truncated; reduce repository size or artifact root scope.");
    return tree.tree;
  }

  private async fetchBlob(sha: string, filePath: string) {
    const blob = await this.githubJson<GitHubBlobResponse>(this.githubUrl(`/git/blobs/${encodeURIComponent(sha)}`));
    if (typeof blob.size === "number" && blob.size > githubMaxBlobBytes) {
      throw new Error(`${filePath}: Markdown artifact exceeds the ${githubMaxBlobBytes} byte size limit.`);
    }
    if (blob.encoding !== "base64" || typeof blob.content !== "string") {
      throw new Error(`${filePath}: GitHub blob response used an unsupported encoding.`);
    }
    const normalized = blob.content.replace(/\s+/g, "");
    return Buffer.from(normalized, "base64").toString("utf8");
  }
}

export function createArtifactRepository(access: RepositoryAccessContext): ArtifactRepository {
  const backend = getArtifactRepositoryBackend();
  console.info(JSON.stringify({ event: "artifact_repository_selected", backend }));
  if (backend === "file") return new FileArtifactRepository();
  const owner = process.env.GITHUB_ARTIFACT_REPOSITORY_OWNER;
  const repo = process.env.GITHUB_ARTIFACT_REPOSITORY_NAME;
  const branch = process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH ?? defaultGitHubArtifactBranch;
  const rootPath = trimSlashes(process.env.GITHUB_ARTIFACT_REPOSITORY_ROOT ?? defaultGitHubArtifactRoot);
  if (!owner || !repo || !branch || !rootPath) throw new ArtifactRepositoryConfigurationError("GitHub artifact repository configuration is incomplete.");
  if (access.owner.toLowerCase() !== owner.toLowerCase() || access.repo.toLowerCase() !== repo.toLowerCase() || !Number.isSafeInteger(access.repositoryId)) throw new ArtifactRepositoryConfigurationError("Repository access context does not match configuration.");
  return new GitHubArtifactRepository({ owner: access.owner, repo: access.repo, branch, rootPath, credentialProvider: access.installationTokenProvider });
}
