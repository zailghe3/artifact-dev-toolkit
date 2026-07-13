import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { artifactMetadataSchema, artifactStatusSchema } from "./artifact-schemas.ts";

const artifactsDir = path.join(process.cwd(), "artifacts");
const githubApiBaseUrl = "https://api.github.com";
const githubMaxBlobBytes = 1024 * 1024;
const defaultGitHubArtifactBranch = "main";
const defaultGitHubArtifactRoot = "artifacts";

const artifactSchema = artifactMetadataSchema;

export type Artifact = z.infer<typeof artifactSchema> & {
  body: string;
  excerpt: string;
  path: string;
};

export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

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
  token: string;
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

function toExcerpt(body: string) {
  return body.replace(/\s+/g, " ").trim().slice(0, 180);
}

function formatArtifactError(file: string, error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join(".") : "front matter";
      return `${file}: ${field}: ${issue.message}`;
    }).join("; ");
  }
  return `${file}: ${(error as Error).message}`;
}

function parseArtifactMarkdown(raw: string, filePath: string): Artifact {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (error) {
    throw new Error(`${filePath}: Unable to parse Markdown front matter: ${(error as Error).message}`);
  }

  if (!String(parsed.matter ?? "").trim()) {
    throw new Error(`${filePath}: Missing YAML front matter.`);
  }

  try {
    const data = artifactSchema.parse(parsed.data);
    return {
      ...data,
      body: parsed.content.trim(),
      excerpt: toExcerpt(parsed.content),
      path: filePath,
    };
  } catch (error) {
    throw new Error(formatArtifactError(filePath, error));
  }
}

function validateUniqueArtifactIds(artifacts: Artifact[]) {
  const seen = new Map<string, string>();
  for (const artifact of artifacts) {
    const previous = seen.get(artifact.id);
    if (previous) {
      throw new Error(`Duplicate artifact id "${artifact.id}" found in ${artifact.path}; already used by ${previous}.`);
    }
    seen.set(artifact.id, artifact.path);
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
        return parseArtifactMarkdown(raw, path.relative(process.cwd(), file).split(path.sep).join("/"));
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

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

function getGitHubRepositoryConfig(): GitHubArtifactRepositoryConfig {
  const owner = process.env.GITHUB_ARTIFACT_REPOSITORY_OWNER;
  const repo = process.env.GITHUB_ARTIFACT_REPOSITORY_NAME;
  const token = process.env.GITHUB_ARTIFACT_REPOSITORY_TOKEN;
  const missing = [
    ["GITHUB_ARTIFACT_REPOSITORY_OWNER", owner],
    ["GITHUB_ARTIFACT_REPOSITORY_NAME", repo],
    ["GITHUB_ARTIFACT_REPOSITORY_TOKEN", token],
  ].filter(([, value]) => !value);

  if (missing.length) {
    throw new Error(`Missing GitHub artifact repository configuration: ${missing.map(([name]) => name).join(", ")}`);
  }

  return {
    owner: owner!,
    repo: repo!,
    token: token!,
    branch: process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH ?? defaultGitHubArtifactBranch,
    rootPath: process.env.GITHUB_ARTIFACT_REPOSITORY_ROOT ?? defaultGitHubArtifactRoot,
  };
}

export class GitHubArtifactRepository implements ArtifactRepository {
  private readonly branch: string;
  private readonly rootPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly config: GitHubArtifactRepositoryConfig;

  constructor(config: GitHubArtifactRepositoryConfig = getGitHubRepositoryConfig()) {
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

    const artifacts = await Promise.all(
      files.map(async (file) => {
        if (!file.sha) throw new Error(`${file.path}: GitHub tree entry is missing a blob SHA.`);
        const raw = await this.fetchBlob(file.sha, file.path!);
        return parseArtifactMarkdown(raw, file.path!);
      }),
    );

    validateUniqueArtifactIds(artifacts);
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

  private async githubJson<T>(url: string, fileContext?: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.config.token}`,
        "user-agent": "artifact-dev-toolkit",
        "x-github-api-version": "2022-11-28",
      },
    });

    if (!response.ok) {
      const context = fileContext ? `${fileContext}: ` : "";
      throw new Error(`${context}GitHub artifact repository request failed with ${response.status} ${response.statusText}.`);
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
    const blob = await this.githubJson<GitHubBlobResponse>(this.githubUrl(`/git/blobs/${encodeURIComponent(sha)}`), filePath);
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

export function createArtifactRepository(): ArtifactRepository {
  if (process.env.ARTIFACT_REPOSITORY === "github") {
    return new GitHubArtifactRepository();
  }

  return new FileArtifactRepository();
}
