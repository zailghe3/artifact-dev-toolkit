import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { DEFAULT_ARTIFACT_BRANCH, DEFAULT_ARTIFACT_ROOT, normalizeArtifactMetadata, parseArtifactMarkdown, serializeArtifactMarkdown, trimSlashes, validateArtifactPath, validateUniqueArtifactIds, type ArtifactMetadata, type ArtifactModel } from "./artifact-contract.ts";
import type { RepositoryAccessContext } from "./repository-authorization.ts";

const artifactsDir = path.join(process.cwd(), "artifacts");
const githubApiBaseUrl = "https://api.github.com";
const githubMaxBlobBytes = 1024 * 1024;
const githubBlobConcurrency = 4;
const githubMaxAttempts = 3;
const githubMaximumRetryDelayMs = 5_000;
const defaultGitHubArtifactBranch = DEFAULT_ARTIFACT_BRANCH;
const defaultGitHubArtifactRoot = DEFAULT_ARTIFACT_ROOT;

export type Artifact = ArtifactModel;
export type ArtifactStatus = z.infer<typeof import("./artifact-schemas.ts").artifactStatusSchema>;

export type CreateVariationInput = {
  source: Artifact;
  body: string;
  title?: string;
};

export type CreateArtifactInput = { metadata: ArtifactMetadata; body: string; actorLogin: string };
export type UpdateArtifactInput = { id: string; metadata: ArtifactMetadata; body: string; currentFileSha: string; actorLogin: string };
export type ArtifactWriteResult = { artifactId: string; path: string; fileSha: string; commitSha: string; commitUrl: string; repositoryRevision?: string };

export interface ArtifactRepository {
  list(): Promise<Artifact[]>;
  findById(id: string): Promise<Artifact | undefined>;
  create(input: CreateArtifactInput): Promise<ArtifactWriteResult>;
  update(input: UpdateArtifactInput): Promise<ArtifactWriteResult>;
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
  sleep?: (milliseconds: number) => Promise<void>;
  logger?: Pick<Console, "info" | "error">;
};

async function mapWithConcurrency<T, U>(values: readonly T[], concurrency: number, mapper: (value: T, index: number) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

const secretPatterns = [
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i,
  /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}_[A-Za-z0-9_]{59,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
];

function assertNoSecrets(value: string) {
  if (secretPatterns.some((pattern) => pattern.test(value))) {
    throw new ArtifactSecretRejectedError();
  }
}

const artifactTypeDirectories: Record<ArtifactMetadata["type"], string> = {
  prompt: "prompts", agent: "agents", snippet: "snippets", template: "templates", "app-idea": "app-ideas",
};

function prepareWrite(metadataInput: ArtifactMetadata, body: string) {
  try {
    const metadata = normalizeArtifactMetadata(metadataInput);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.id)) throw new ArtifactWriteValidationError();
    if (!body.trim()) throw new ArtifactWriteValidationError();
    const markdown = serializeArtifactMarkdown(metadata, body);
    assertNoSecrets(markdown);
    return { metadata, markdown };
  } catch (error) {
    if (error instanceof ArtifactSecretRejectedError || error instanceof ArtifactWriteValidationError) throw error;
    throw new ArtifactWriteValidationError();
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

  async create(): Promise<ArtifactWriteResult> { throw new ArtifactRepositoryConfigurationError("Direct artifact writes require the GitHub repository backend."); }
  async update(): Promise<ArtifactWriteResult> { throw new ArtifactRepositoryConfigurationError("Direct artifact writes require the GitHub repository backend."); }

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
export class ArtifactWriteValidationError extends Error { constructor() { super("Artifact metadata or content is invalid."); } }
export class ArtifactSecretRejectedError extends Error { constructor() { super("Artifact content was rejected by the secret safety check."); } }
export class ArtifactDuplicateError extends Error { constructor() { super("An artifact with this ID or path already exists."); } }
export class ArtifactWriteConflictError extends Error { constructor() { super("The artifact changed since it was loaded."); } }
export class ArtifactWritePermissionError extends Error { constructor() { super("The GitHub App does not have artifact write permission."); } }
export class ArtifactWriteAuthenticationError extends Error { constructor() { super("GitHub repository authentication failed."); } }
export class ArtifactNotFoundError extends Error { constructor() { super("Artifact not found."); } }
export class ArtifactWriteResponseError extends Error { constructor() { super("GitHub returned an invalid write response."); } }

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
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly logger: Pick<Console, "info" | "error">;
  private credentialPromise?: Promise<string>;
  private readonly config: GitHubArtifactRepositoryConfig;

  constructor(config: GitHubArtifactRepositoryConfig) {
    this.config = config;
    this.branch = config.branch ?? defaultGitHubArtifactBranch;
    this.rootPath = trimSlashes(config.rootPath ?? defaultGitHubArtifactRoot);
    this.fetchImpl = config.fetch ?? fetch;
    this.sleep = config.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.logger = config.logger ?? console;
  }

  async list(): Promise<Artifact[]> {
    const tree = await this.fetchTree();
    const prefix = this.rootPath.length > 0 ? `${this.rootPath}/` : "";
    const files = tree
      .filter((entry) => entry.type === "blob" && typeof entry.path === "string" && entry.path.startsWith(prefix) && entry.path.endsWith(".md"))
      .sort((a, b) => a.path!.localeCompare(b.path!));
    this.logger.info(JSON.stringify({ event: "github_artifact_tree_loaded", backend: "github", owner: this.config.owner, repository: this.config.repo, branch: this.branch, rootPath: this.rootPath, treeEntryCount: tree.length, markdownFileCount: files.length }));

    for (const file of files) {
      const pathError = validateArtifactPath(file.path!, this.rootPath);
      if (pathError) throw new Error(`${file.path}: ${pathError}`);
    }

    const artifacts = await mapWithConcurrency(files, githubBlobConcurrency,
      async (file) => {
        if (!file.sha) throw new Error(`${file.path}: GitHub tree entry is missing a blob SHA.`);
        const raw = await this.fetchBlob(file.sha, file.path!);
        return parseArtifactMarkdown(raw, file.path!);
      },
    );

    validateUniqueArtifactIds(artifacts);
    this.logger.info(JSON.stringify({ event: "github_artifacts_loaded", backend: "github", owner: this.config.owner, repository: this.config.repo, parsedArtifactCount: artifacts.length }));
    return artifacts.sort((a, b) => a.title.localeCompare(b.title));
  }

  async findById(id: string): Promise<Artifact | undefined> {
    const artifacts = await this.list();
    return artifacts.find((artifact) => artifact.id === id);
  }

  async create(input: CreateArtifactInput): Promise<ArtifactWriteResult> {
    if (!/^[A-Za-z0-9-]+$/.test(input.actorLogin)) throw new ArtifactWriteValidationError();
    const { metadata, markdown } = prepareWrite(input.metadata, input.body);
    const path = this.artifactPath(metadata);
    const tree = await this.fetchTree();
    if (tree.some((entry) => entry.type === "blob" && entry.path === path)) throw new ArtifactDuplicateError();
    const artifacts = await this.artifactsFromTree(tree);
    if (artifacts.some((artifact) => artifact.id === metadata.id)) throw new ArtifactDuplicateError();
    return this.writeContents(path, metadata.id, markdown, input.actorLogin, undefined);
  }

  async update(input: UpdateArtifactInput): Promise<ArtifactWriteResult> {
    if (!/^[A-Za-z0-9-]+$/.test(input.actorLogin)) throw new ArtifactWriteValidationError();
    const { metadata, markdown } = prepareWrite(input.metadata, input.body);
    if (metadata.id !== input.id || !input.currentFileSha.trim()) throw new ArtifactWriteValidationError();
    const tree = await this.fetchTree();
    const artifacts = await this.artifactsFromTree(tree);
    const artifact = artifacts.find((candidate) => candidate.id === input.id);
    if (!artifact) throw new ArtifactNotFoundError();
    const entry = tree.find((candidate) => candidate.type === "blob" && candidate.path === artifact.path);
    if (!entry?.sha) throw new ArtifactWriteResponseError();
    if (entry.sha !== input.currentFileSha) throw new ArtifactWriteConflictError();
    // Renaming paths is intentionally unsupported; type changes which imply a move fail safely.
    if (this.artifactPath(metadata) !== artifact.path) throw new ArtifactWriteValidationError();
    return this.writeContents(artifact.path, metadata.id, markdown, input.actorLogin, input.currentFileSha);
  }

  async createVariation(input: CreateVariationInput): Promise<string> {
    assertNoSecrets(input.body);
    assertNoSecrets(input.title ?? "");
    throw new Error("GitHubArtifactRepository is read-only. Creating or editing artifacts is outside the DATA-002 scope.");
  }

  private githubUrl(pathname: string) {
    return `${githubApiBaseUrl}/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}${pathname}`;
  }

  private artifactPath(metadata: ArtifactMetadata) {
    return `${this.rootPath}/${artifactTypeDirectories[metadata.type]}/${metadata.id}.md`;
  }

  private async artifactsFromTree(tree: GitHubTreeEntry[]) {
    const prefix = `${this.rootPath}/`;
    const files = tree.filter((entry) => entry.type === "blob" && entry.path?.startsWith(prefix) && entry.path.endsWith(".md"));
    const artifacts = await mapWithConcurrency(files, githubBlobConcurrency, async (file) => {
      if (!file.path || !file.sha) throw new ArtifactRepositoryContentError();
      if (validateArtifactPath(file.path, this.rootPath)) throw new ArtifactRepositoryContentError();
      return parseArtifactMarkdown(await this.fetchBlob(file.sha, file.path), file.path);
    });
    validateUniqueArtifactIds(artifacts);
    return artifacts;
  }

  private async writeContents(filePath: string, artifactId: string, markdown: string, actorLogin: string, sha?: string): Promise<ArtifactWriteResult> {
    let credential: string;
    try { credential = await this.credential(); }
    catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404) throw new ArtifactWriteAuthenticationError();
      if (status === 429 || status === undefined || status >= 500) throw new ArtifactRepositoryUnavailableError(status);
      throw new ArtifactRepositoryConfigurationError("Installation credential could not be created.");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.githubUrl(`/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`), {
        method: "PUT",
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${credential}`, "content-type": "application/json", "user-agent": "artifact-dev-toolkit", "x-github-api-version": "2022-11-28" },
        body: JSON.stringify({ message: `${sha ? "Update" : "Create"} artifact ${artifactId} (requested by @${actorLogin})`, content: Buffer.from(markdown).toString("base64"), branch: this.branch, ...(sha ? { sha } : {}) }),
      });
    } catch { throw new ArtifactRepositoryUnavailableError(); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401) throw new ArtifactWriteAuthenticationError();
      if (response.status === 403) throw new ArtifactWritePermissionError();
      if (response.status === 409 || response.status === 422) throw sha ? new ArtifactWriteConflictError() : new ArtifactDuplicateError();
      if (response.status === 429 || response.status >= 500) throw new ArtifactRepositoryUnavailableError(response.status);
      throw new ArtifactWriteResponseError();
    }
    let value: unknown;
    try { value = await response.json(); } catch { throw new ArtifactWriteResponseError(); }
    const parsed = z.object({ content: z.object({ path: z.string(), sha: z.string().min(1) }), commit: z.object({ sha: z.string().min(1), html_url: z.string().url() }) }).safeParse(value);
    if (!parsed.success || parsed.data.content.path !== filePath) throw new ArtifactWriteResponseError();
    return { artifactId, path: filePath, fileSha: parsed.data.content.sha, commitSha: parsed.data.commit.sha, commitUrl: parsed.data.commit.html_url, repositoryRevision: parsed.data.commit.sha };
  }

  private async credential(): Promise<string> {
    this.credentialPromise ??= this.config.credentialProvider();
    return this.credentialPromise;
  }

  private retryDelay(response: Response | undefined, attempt: number) {
    const retryAfter = response?.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const milliseconds = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(milliseconds)) return Math.min(githubMaximumRetryDelayMs, Math.max(0, milliseconds));
    }
    return Math.min(githubMaximumRetryDelayMs, 100 * (2 ** (attempt - 1)));
  }

  private async githubJson<T>(url: string, operation: "tree" | "blob", filePath?: string): Promise<T> {
    let credential: string;
    try {
      credential = await this.credential();
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 429 || (typeof status === "number" && status >= 500) || status === undefined) throw new ArtifactRepositoryUnavailableError(status);
      if (status === 401 || status === 403 || status === 404) throw new ArtifactRepositoryAccessError();
      throw new ArtifactRepositoryConfigurationError("Installation credential could not be created.");
    }
    for (let attempt = 1; attempt <= githubMaxAttempts; attempt++) {
      let response: Response | undefined;
      try {
        response = await this.fetchImpl(url, {
          headers: { accept: "application/vnd.github+json", authorization: `Bearer ${credential}`, "user-agent": "artifact-dev-toolkit", "x-github-api-version": "2022-11-28" },
        });
      } catch {
        if (attempt < githubMaxAttempts) {
          this.logRetry(operation, filePath, undefined, attempt + 1);
          await this.sleep(this.retryDelay(undefined, attempt));
          continue;
        }
        this.logFailure(operation, filePath, undefined, attempt);
        throw new ArtifactRepositoryUnavailableError();
      }
      if (response.ok) {
        try {
          return await response.json() as T;
        } catch (error) {
          if (error instanceof TypeError) {
            if (attempt < githubMaxAttempts) {
              this.logRetry(operation, filePath, undefined, attempt + 1);
              await this.sleep(this.retryDelay(undefined, attempt));
              continue;
            }
            this.logFailure(operation, filePath, undefined, attempt);
            throw new ArtifactRepositoryUnavailableError();
          }
          throw new ArtifactRepositoryContentError();
        }
      }
      const retryable = response.status === 429 || response.status >= 500 && response.status <= 599;
      if (!retryable) {
        if (response.status === 401 || response.status === 403) throw new ArtifactRepositoryAccessError();
        throw new ArtifactRepositoryContentError();
      }
      const delay = this.retryDelay(response, attempt);
      await response.body?.cancel().catch(() => undefined);
      if (attempt < githubMaxAttempts) {
        this.logRetry(operation, filePath, response.status, attempt + 1);
        await this.sleep(delay);
        continue;
      }
      this.logFailure(operation, filePath, response.status, attempt);
      throw new ArtifactRepositoryUnavailableError(response.status);
    }
    throw new ArtifactRepositoryUnavailableError();
  }

  private logRetry(operation: "tree" | "blob", filePath: string | undefined, status: number | undefined, attempt: number) {
    this.logger.info(JSON.stringify({ event: "github_artifact_request_retry", operation, ...(filePath ? { path: filePath } : {}), ...(status === undefined ? {} : { status }), attempt, maxAttempts: githubMaxAttempts }));
  }

  private logFailure(operation: "tree" | "blob", filePath: string | undefined, status: number | undefined, attempts: number) {
    this.logger.error(JSON.stringify({ event: "github_artifact_request_failed", operation, ...(filePath ? { path: filePath } : {}), category: "temporary_unavailable", ...(status === undefined ? {} : { status }), attempts }));
  }

  private async fetchTree() {
    const tree = await this.githubJson<GitHubTreeResponse>(this.githubUrl(`/git/trees/${encodeURIComponent(this.branch)}?recursive=1`), "tree");
    if (!Array.isArray(tree.tree)) throw new Error("GitHub artifact repository tree response was malformed.");
    if (tree.truncated) throw new Error("GitHub artifact repository tree response was truncated; reduce repository size or artifact root scope.");
    return tree.tree;
  }

  private async fetchBlob(sha: string, filePath: string) {
    const blob = await this.githubJson<GitHubBlobResponse>(this.githubUrl(`/git/blobs/${encodeURIComponent(sha)}`), "blob", filePath);
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
