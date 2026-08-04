import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ArtifactMarkdownParseError, DEFAULT_ARTIFACT_BRANCH, DEFAULT_ARTIFACT_ROOT, MAX_SERIALIZED_ARTIFACT_BYTES, normalizeArtifactMetadata, parseArtifactMarkdown, serializeArtifactMarkdown, trimSlashes, validateArtifactPath, validateUniqueArtifactIds, type ArtifactMetadata, type ArtifactModel } from "./artifact-contract.ts";
import type { RepositoryAccessContext } from "./repository-authorization.ts";
import type { RepositoryCredential, RepositoryCredentialCapability } from "./github-app.ts";
import { slugify } from "./artifact-id.ts";
export { slugify } from "./artifact-id.ts";

const artifactsDir = path.join(process.cwd(), "artifacts");
const githubApiBaseUrl = "https://api.github.com";
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
  actorLogin: string;
};

export type CreateArtifactInput = { metadata: ArtifactMetadata; body: string; actorLogin: string };
export type UpdateArtifactInput = { id: string; metadata: ArtifactMetadata; body: string; currentFileSha: string; actorLogin: string };
export type ProposeArtifactUpdateInput = UpdateArtifactInput;
export type DeleteArtifactInput = { id: string; currentFileSha: string; actorLogin: string };
export type ArtifactDeleteResult = { artifactId: string; path: string; commitSha: string; commitUrl: string; repositoryRevision: string };
export type ArtifactWriteResult = { artifactId: string; path: string; fileSha: string; commitSha: string; commitUrl: string; repositoryRevision?: string };
export type ArtifactProposalResult = { artifactId: string; path: string; branchName: string; commitSha: string; pullRequestNumber: number; pullRequestUrl: string };
export type CreateVariationResult = { id: string; path: string; fileSha?: string; commitSha?: string; commitUrl?: string; repositoryRevision?: string };
export type ArtifactWithRevision = { artifact: Artifact; currentFileSha: string };
export type RepositoryCatalogue = { artifacts: Artifact[]; revision: string; fileShas: Record<string, string> };
export type ArtifactValidationDiagnostic = { path: string; code: "invalid_path" | "unsupported_encoding" | "blob_too_large" | "missing_blob_sha" | "blob_unavailable" | "invalid_front_matter" | "invalid_metadata" | "invalid_body" | "duplicate_id"; message: string };
export type RepositoryValidationReport = { revision: string; validCount: number; invalidCount: number; errors: ArtifactValidationDiagnostic[]; omittedErrorCount: number };

export interface ArtifactRepository {
  list(): Promise<Artifact[]>;
  findById(id: string): Promise<Artifact | undefined>;
  findByIdWithRevision(id: string): Promise<ArtifactWithRevision | undefined>;
  getBaseRevision(): Promise<string>;
  loadCatalogue(revision?: string): Promise<RepositoryCatalogue>;
  diagnoseCatalogue?(revision?: string): Promise<RepositoryValidationReport>;
  create(input: CreateArtifactInput): Promise<ArtifactWriteResult>;
  update(input: UpdateArtifactInput): Promise<ArtifactWriteResult>;
  proposeUpdate(input: ProposeArtifactUpdateInput): Promise<ArtifactProposalResult>;
  delete(input: DeleteArtifactInput): Promise<ArtifactDeleteResult>;
  proposeDelete(input: DeleteArtifactInput): Promise<ArtifactProposalResult>;
  createVariation(input: CreateVariationInput): Promise<CreateVariationResult>;
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
  credentialProvider: (capability: RepositoryCredentialCapability) => Promise<RepositoryCredential>;
  branch?: string;
  rootPath?: string;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  logger?: Pick<Console, "info" | "error">;
  now?: () => Date;
  randomBytes?: (length: number) => Uint8Array;
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

export function prepareArtifactWrite(metadataInput: ArtifactMetadata, body: string) {
  try {
    const metadata = normalizeArtifactMetadata(metadataInput);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.id)) throw new ArtifactWriteValidationError();
    if (!body.trim()) throw new ArtifactWriteValidationError();
    const markdown = serializeArtifactMarkdown(metadata, body);
    if (Buffer.byteLength(markdown, "utf8") > MAX_SERIALIZED_ARTIFACT_BYTES) throw new ArtifactWriteTooLargeError();
    assertNoSecrets(markdown);
    return { metadata, markdown };
  } catch (error) {
    if (error instanceof ArtifactSecretRejectedError || error instanceof ArtifactWriteValidationError || error instanceof ArtifactWriteTooLargeError) throw error;
    throw new ArtifactWriteValidationError();
  }
}

export function validateImmutableLifecycleMetadata(stored: Artifact, submitted: ArtifactMetadata) {
  const metadata = normalizeArtifactMetadata(submitted);
  if (metadata.id !== stored.id || metadata.type !== stored.type || metadata.status !== stored.status || metadata.sourceId !== stored.sourceId || String(metadata.createdAt ?? "") !== String(stored.createdAt ?? "")) throw new ArtifactWriteValidationError();
  return metadata;
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

type VariationGeneration = { now: () => Date; randomBytes: (length: number) => Uint8Array };

function secureRandomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function prepareVariation(source: Artifact, title: string | undefined, generation: VariationGeneration = { now: () => new Date(), randomBytes: secureRandomBytes }) {
  const timestamp = generation.now().toISOString();
  const variationTitle = title?.trim() || `${source.title} Variation`;
  const idBase = slugify(variationTitle) || slugify(`${source.id} variation`);
  if (!idBase) throw new ArtifactWriteValidationError();
  const suffix = Array.from(generation.randomBytes(4), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!/^[a-f0-9]{8}$/.test(suffix)) throw new ArtifactWriteValidationError();
  const id = `${idBase}-${timestamp.slice(0, 10)}-${timestamp.slice(11, 19).replace(/:/g, "")}-${suffix}`;
  const metadata: ArtifactMetadata = {
    id,
    title: variationTitle,
    type: source.type,
    status: "draft",
    tags: Array.from(new Set([...source.tags, "variation"])),
    aliases: [...source.aliases],
    sourceId: source.id,
    createdAt: timestamp,
  };
  return { id, metadata };
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

  async findByIdWithRevision(): Promise<ArtifactWithRevision | undefined> {
    throw new ArtifactRepositoryConfigurationError("File-backed artifacts do not expose GitHub revisions.");
  }
  async getBaseRevision(): Promise<string> { throw new ArtifactRepositoryConfigurationError("File-backed artifacts do not expose GitHub revisions."); }
  async loadCatalogue(): Promise<RepositoryCatalogue> { throw new ArtifactRepositoryConfigurationError("File-backed artifacts do not expose GitHub revisions."); }

  async create(): Promise<ArtifactWriteResult> { throw new ArtifactRepositoryConfigurationError("Direct artifact writes require the GitHub repository backend."); }
  async update(): Promise<ArtifactWriteResult> { throw new ArtifactRepositoryConfigurationError("Direct artifact writes require the GitHub repository backend."); }
  async proposeUpdate(): Promise<ArtifactProposalResult> { throw new ArtifactRepositoryConfigurationError("Production proposals require the GitHub repository backend."); }
  async delete(): Promise<ArtifactDeleteResult> { throw new ArtifactRepositoryConfigurationError("Direct artifact deletion requires the GitHub repository backend."); }
  async proposeDelete(): Promise<ArtifactProposalResult> { throw new ArtifactRepositoryConfigurationError("Deletion proposals require the GitHub repository backend."); }

  async createVariation({ source, body, title }: CreateVariationInput): Promise<CreateVariationResult> {
    const { id, metadata } = prepareVariation(source, title);
    const { markdown } = prepareArtifactWrite(metadata, body.trim());
    const filePath = path.join(this.rootDir, "variations", `${id}.md`);
    if ((await this.list()).some((artifact) => artifact.id === id || path.resolve(artifact.path) === path.resolve(filePath))) throw new ArtifactDuplicateError();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try { await fs.writeFile(filePath, markdown, { encoding: "utf8", flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ArtifactDuplicateError(); throw error; }
    return { id, path: filePath.split(path.sep).join("/") };
  }
}


export type ArtifactRepositoryBackend = "file" | "github";
export class ArtifactRepositoryConfigurationError extends Error {}
export class ArtifactRepositoryUnavailableError extends Error {
  readonly status?: number;
  constructor(status?: number) { super("The artifact repository is temporarily unavailable."); this.status = status; }
}
export class ArtifactRepositoryAccessError extends Error { constructor() { super("Artifact repository access is denied."); } }
export class ArtifactRepositoryNotFoundError extends Error { constructor() { super("The configured artifact repository was not found."); } }
export class ArtifactBranchNotFoundError extends Error { constructor() { super("The configured artifact repository branch was not found."); } }
export class ArtifactRepositoryContentError extends Error { constructor() { super("The artifact repository contains invalid content."); } }
export class ArtifactWriteValidationError extends Error { constructor() { super("Artifact metadata or content is invalid."); } }
export class ArtifactWriteTooLargeError extends Error { constructor() { super("Artifact exceeds the maximum allowed size."); } }
export class ArtifactSecretRejectedError extends Error { constructor() { super("Artifact content was rejected by the secret safety check."); } }
export class ArtifactDuplicateError extends Error { constructor() { super("An artifact with this ID or path already exists."); } }
export class ArtifactWriteConflictError extends Error { constructor() { super("The artifact changed since it was loaded."); } }
export class ArtifactWritePermissionError extends Error { constructor() { super("The GitHub App does not have artifact write permission."); } }
export class ArtifactWriteAuthenticationError extends Error { constructor() { super("GitHub repository authentication failed."); } }
export class ArtifactNotFoundError extends Error { constructor() { super("Artifact not found."); } }
export class ArtifactWriteResponseError extends Error { constructor() { super("GitHub returned an invalid write response."); } }
export class ArtifactProposalCollisionError extends Error { constructor() { super("A proposal branch already exists."); } }
export class ArtifactProposalPermissionError extends Error { constructor() { super("The GitHub App does not have proposal permission."); } }
export class ArtifactProductionUpdateRequiresProposalError extends Error { constructor() { super("Production updates require a proposal."); } }
export class ArtifactProductionDeleteRequiresProposalError extends Error { constructor() { super("Production deletion requires a proposal."); } }
export class ArtifactProposalIncompleteError extends Error {
  readonly branchName: string;
  readonly branchUrl: string;
  constructor(branchName: string, branchUrl: string) { super("The proposal branch exists, but the pull request could not be completed."); this.branchName = branchName; this.branchUrl = branchUrl; }
}

export function proposalBranchName(artifactId: string, fileSha: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artifactId) || artifactId.length > 80 || !/^[a-f0-9]{8,64}$/i.test(fileSha)) throw new ArtifactWriteValidationError();
  return `artifact-change/${artifactId.toLowerCase()}-${fileSha.slice(0, 8).toLowerCase()}`;
}
export function deletionProposalBranchName(artifactId: string, fileSha: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artifactId) || artifactId.length > 80 || !/^[a-f0-9]{8,64}$/i.test(fileSha)) throw new ArtifactWriteValidationError();
  return `artifact-delete/${artifactId.toLowerCase()}-${fileSha.slice(0, 8).toLowerCase()}`;
}

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
  private readonly variationGeneration: VariationGeneration;
  private readonly credentialPromises = new Map<RepositoryCredentialCapability, Promise<string>>();
  private readonly config: GitHubArtifactRepositoryConfig;

  constructor(config: GitHubArtifactRepositoryConfig) {
    this.config = config;
    this.branch = config.branch ?? defaultGitHubArtifactBranch;
    this.rootPath = trimSlashes(config.rootPath ?? defaultGitHubArtifactRoot);
    this.fetchImpl = config.fetch ?? fetch;
    this.sleep = config.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.logger = config.logger ?? console;
    this.variationGeneration = { now: config.now ?? (() => new Date()), randomBytes: config.randomBytes ?? secureRandomBytes };
  }

  async list(): Promise<Artifact[]> {
    const tree = await this.fetchTree("read");
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
        const raw = await this.fetchBlob(file.sha, file.path!, "read");
        try { return parseArtifactMarkdown(raw, file.path!); } catch (error) { if (error instanceof ArtifactMarkdownParseError) throw new ArtifactRepositoryContentError(); throw error; }
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

  async findByIdWithRevision(id: string): Promise<ArtifactWithRevision | undefined> {
    const tree = await this.fetchTree("read");
    const artifacts = await this.artifactsFromTree(tree, "read");
    const artifact = artifacts.find((candidate) => candidate.id === id);
    if (!artifact) return undefined;
    const entry = tree.find((candidate) => candidate.type === "blob" && candidate.path === artifact.path);
    if (typeof entry?.sha !== "string" || !entry.sha.trim()) throw new ArtifactRepositoryContentError();
    return { artifact, currentFileSha: entry.sha };
  }

  async getBaseRevision(): Promise<string> {
    return this.resolveBranch("read");
  }

  private async resolveBranch(capability: RepositoryCredentialCapability): Promise<string> {
    const ref = await this.githubJson<{ object?: { sha?: string } }>(this.githubUrl(`/git/ref/heads/${encodeURIComponent(this.branch)}`), "tree", undefined, capability);
    if (typeof ref.object?.sha !== "string" || !/^[a-f0-9]{7,64}$/i.test(ref.object.sha)) throw new ArtifactRepositoryContentError();
    return ref.object.sha;
  }

  async loadCatalogue(revision?: string): Promise<RepositoryCatalogue> {
    const resolvedRevision = revision ?? await this.getBaseRevision();
    const tree = await this.fetchTree("read", resolvedRevision);
    const artifacts = await this.artifactsFromTree(tree, "read");
    const fileShas: Record<string, string> = {};
    for (const artifact of artifacts) {
      const sha = tree.find((entry) => entry.type === "blob" && entry.path === artifact.path)?.sha;
      if (!sha || !/^[a-f0-9]{7,64}$/i.test(sha)) throw new ArtifactRepositoryContentError();
      fileShas[artifact.id] = sha;
    }
    return { artifacts: artifacts.sort((a, b) => a.title.localeCompare(b.title)), revision: resolvedRevision, fileShas };
  }

  async diagnoseCatalogue(revision?: string): Promise<RepositoryValidationReport> {
    const resolvedRevision = revision ?? await this.getBaseRevision();
    const tree = await this.fetchTree("read", resolvedRevision);
    const prefix = this.rootPath ? `${this.rootPath}/` : "";
    const files = tree.filter((entry) => entry.type === "blob" && typeof entry.path === "string" && entry.path.startsWith(prefix) && entry.path.endsWith(".md"));
    const results = await mapWithConcurrency(files, githubBlobConcurrency, async (file, entryIndex) => {
      const safePath = typeof file.path === "string" && !validateArtifactPath(file.path, this.rootPath) ? file.path : "[unsafe repository path]";
      if (safePath.startsWith("[")) return { entryIndex, error: { path: safePath, code: "invalid_path", message: "Artifact path is not a safe repository-relative path under the configured root." } as ArtifactValidationDiagnostic };
      if (!file.sha || !/^[a-f0-9]{7,64}$/i.test(file.sha)) return { entryIndex, error: { path: safePath, code: "missing_blob_sha", message: "GitHub did not provide a valid blob revision." } as ArtifactValidationDiagnostic };
      if (typeof file.size === "number" && file.size > MAX_SERIALIZED_ARTIFACT_BYTES) return { entryIndex, error: { path: safePath, code: "blob_too_large", message: "Artifact exceeds the maximum allowed size." } as ArtifactValidationDiagnostic };
      try { return { entryIndex, artifact: parseArtifactMarkdown(await this.fetchBlob(file.sha, safePath, "read"), safePath) }; }
      catch (error) {
        if (error instanceof ArtifactRepositoryUnavailableError || error instanceof ArtifactRepositoryAccessError) throw error;
        if (error instanceof ArtifactBlobDiagnosticError) return { entryIndex, error: { path: safePath, code: error.code, message: error.code === "unsupported_encoding" ? "Artifact blob encoding is unsupported." : error.code === "blob_unavailable" ? "Artifact blob is unavailable." : "Artifact exceeds the maximum allowed size." } as ArtifactValidationDiagnostic };
        const code: ArtifactValidationDiagnostic["code"] = error instanceof ArtifactMarkdownParseError ? error.code : "invalid_metadata";
        return { entryIndex, error: { path: safePath, code, message: code === "invalid_body" ? "Artifact body is invalid." : code === "invalid_front_matter" ? "Artifact front matter is invalid." : "Artifact metadata is invalid." } as ArtifactValidationDiagnostic };
      }
    });
    const valid = results.flatMap((result) => result.artifact ? [result.artifact] : []);
    const diagnostics = results.flatMap((result) => result.error ? [{ entryIndex: result.entryIndex, error: result.error }] : []);
    const byId = new Map<string, typeof results>(); for (const result of results) if (result.artifact) byId.set(result.artifact.id, [...(byId.get(result.artifact.id) ?? []), result]);
    for (const duplicates of byId.values()) if (duplicates.length > 1) for (const result of duplicates) diagnostics.push({ entryIndex: result.entryIndex, error: { path: result.artifact!.path, code: "duplicate_id", message: "Artifact ID is duplicated by another valid file." } });
    const invalidEntries = new Set(diagnostics.map((item) => item.entryIndex));
    const errors = diagnostics.slice(0, 50).map((item) => item.error);
    return { revision: resolvedRevision, validCount: valid.length - results.filter((result) => result.artifact && invalidEntries.has(result.entryIndex)).length, invalidCount: invalidEntries.size, errors, omittedErrorCount: Math.max(0, diagnostics.length - errors.length) };
  }

  async create(input: CreateArtifactInput): Promise<ArtifactWriteResult> {
    if (!/^[A-Za-z0-9-]+$/.test(input.actorLogin)) throw new ArtifactWriteValidationError();
    const prepared = prepareArtifactWrite(input.metadata, input.body);
    if (prepared.metadata.status !== "draft") throw new ArtifactWriteValidationError();
    return this.createValidatedArtifactAtPath({ metadata: prepared.metadata, body: input.body, path: this.artifactPath(prepared.metadata), actorLogin: input.actorLogin, commitMessage: `Create artifact ${prepared.metadata.id} (requested by @${input.actorLogin})`, prepared });
  }

  async update(input: UpdateArtifactInput): Promise<ArtifactWriteResult> {
    if (!/^[A-Za-z0-9-]+$/.test(input.actorLogin)) throw new ArtifactWriteValidationError();
    const { metadata, markdown } = prepareArtifactWrite(input.metadata, input.body);
    if (metadata.id !== input.id || !input.currentFileSha.trim()) throw new ArtifactWriteValidationError();
    const tree = await this.fetchTree("write");
    const artifacts = await this.artifactsFromTree(tree, "write");
    const artifact = artifacts.find((candidate) => candidate.id === input.id);
    if (!artifact) throw new ArtifactNotFoundError();
    const entry = tree.find((candidate) => candidate.type === "blob" && candidate.path === artifact.path);
    if (!entry?.sha) throw new ArtifactWriteResponseError();
    if (entry.sha !== input.currentFileSha) throw new ArtifactWriteConflictError();
    if (validateArtifactPath(artifact.path, this.rootPath)) throw new ArtifactRepositoryContentError();
    if (artifact.status === "production") throw new ArtifactProductionUpdateRequiresProposalError();
    validateImmutableLifecycleMetadata(artifact, metadata);
    return this.writeContents(artifact.path, metadata.id, markdown, `Update artifact ${metadata.id} (requested by @${input.actorLogin})`, input.currentFileSha);
  }

  async delete(input: DeleteArtifactInput): Promise<ArtifactDeleteResult> {
    const { artifact, path: artifactPath } = await this.resolveDeletion(input, "write");
    if (artifact.status === "production") throw new ArtifactProductionDeleteRequiresProposalError();
    return this.deleteContents(artifactPath, input);
  }

  async proposeDelete(input: DeleteArtifactInput): Promise<ArtifactProposalResult> {
    if (!/^[A-Za-z0-9-]+$/.test(input.actorLogin)) throw new ArtifactWriteValidationError();
    const branchName = deletionProposalBranchName(input.id, input.currentFileSha);
    const baseRef = await this.githubGet<{ object?: { sha?: string } }>(`/git/ref/heads/${encodeURIComponent(this.branch)}`, "tree");
    const baseCommitSha = baseRef.object?.sha;
    if (!baseCommitSha) throw new ArtifactRepositoryContentError();
    const baseCommit = await this.githubGet<{ tree?: { sha?: string } }>(`/git/commits/${encodeURIComponent(baseCommitSha)}`, "tree");
    if (!baseCommit.tree?.sha) throw new ArtifactRepositoryContentError();
    const treeResponse = await this.githubGet<GitHubTreeResponse>(`/git/trees/${encodeURIComponent(baseCommit.tree.sha)}?recursive=1`, "tree");
    if (!Array.isArray(treeResponse.tree) || treeResponse.truncated) throw new ArtifactRepositoryContentError();
    const artifacts = await this.artifactsFromTree(treeResponse.tree, "proposal");
    const artifact = artifacts.find((candidate) => candidate.id === input.id);
    if (!artifact) throw new ArtifactNotFoundError();
    const entry = treeResponse.tree.find((candidate) => candidate.type === "blob" && candidate.path === artifact.path);
    if (!entry?.sha || entry.sha !== input.currentFileSha) throw new ArtifactWriteConflictError();
    if (artifact.status !== "production") throw new ArtifactWriteValidationError();
    const existingRef = await this.optionalGitHubGet<{ object?: { sha?: string } }>(`/git/ref/heads/${branchName.split("/").map(encodeURIComponent).join("/")}`);
    if (existingRef) return this.resolveExistingDeletionProposal(input.id, branchName, artifact.path, input.currentFileSha, baseCommitSha, baseCommit.tree.sha, existingRef.object?.sha);
    const tree = await this.githubWrite<{ sha?: string }>("/git/trees", { base_tree: baseCommit.tree.sha, tree: [{ path: artifact.path, mode: "100644", type: "blob", sha: null }] });
    if (!tree.sha) throw new ArtifactWriteResponseError();
    const commit = await this.githubWrite<{ sha?: string }>("/git/commits", { message: `Propose deletion of artifact ${input.id} (requested by @${input.actorLogin})`, tree: tree.sha, parents: [baseCommitSha] });
    if (!commit.sha) throw new ArtifactWriteResponseError();
    await this.githubWrite("/git/refs", { ref: `refs/heads/${branchName}`, sha: commit.sha });
    try {
      const body = [`Artifact ID: ${input.id}`, `Artifact path: ${artifact.path}`, `Source file SHA: ${input.currentFileSha}`, `Requested by: @${input.actorLogin}`, "The source branch was generated by Artifact Library.", "Artifact Library will not merge this proposal automatically."].join("\n\n");
      const value = await this.githubWrite<unknown>("/pulls", { title: `Delete artifact: ${artifact.title}`, head: branchName, base: this.branch, body });
      const pull = z.object({ number: z.number().int().positive(), html_url: z.string().url() }).parse(value);
      if (!pull.html_url.startsWith("https://github.com/")) throw new ArtifactWriteResponseError();
      return { artifactId: input.id, path: artifact.path, branchName, commitSha: commit.sha, pullRequestNumber: pull.number, pullRequestUrl: pull.html_url };
    } catch (error) {
      if (error instanceof ArtifactProposalPermissionError || error instanceof ArtifactRepositoryUnavailableError || error instanceof ArtifactWriteResponseError || error instanceof z.ZodError) throw new ArtifactProposalIncompleteError(branchName, this.branchHtmlUrl(branchName));
      throw error;
    }
  }

  async createVariation(input: CreateVariationInput): Promise<CreateVariationResult> {
    if (!/^[A-Za-z0-9-]+$/.test(input.actorLogin)) throw new ArtifactWriteValidationError();
    const { id, metadata } = prepareVariation(input.source, input.title, this.variationGeneration);
    const path = `${this.rootPath}/variations/${id}.md`;
    const result = await this.createValidatedArtifactAtPath({ metadata, body: input.body.trim(), path, actorLogin: input.actorLogin, commitMessage: `Create variation ${id} from ${input.source.id} (requested by @${input.actorLogin})` });
    return { id, path: result.path, fileSha: result.fileSha, commitSha: result.commitSha, commitUrl: result.commitUrl, repositoryRevision: result.repositoryRevision };
  }

  async proposeUpdate(input: ProposeArtifactUpdateInput): Promise<ArtifactProposalResult> {
    if (!/^[A-Za-z0-9-]+$/.test(input.actorLogin)) throw new ArtifactWriteValidationError();
    const { metadata, markdown } = prepareArtifactWrite(input.metadata, input.body);
    if (metadata.id !== input.id || !input.currentFileSha.trim()) throw new ArtifactWriteValidationError();
    const branchName = proposalBranchName(input.id, input.currentFileSha);

    const baseRef = await this.githubGet<{ object?: { sha?: string } }>(`/git/ref/heads/${encodeURIComponent(this.branch)}`, "tree");
    const baseCommitSha = baseRef.object?.sha;
    if (!baseCommitSha) throw new ArtifactRepositoryContentError();
    const baseCommit = await this.githubGet<{ tree?: { sha?: string } }>(`/git/commits/${encodeURIComponent(baseCommitSha)}`, "tree");
    if (!baseCommit.tree?.sha) throw new ArtifactRepositoryContentError();
    const treeResponse = await this.githubGet<GitHubTreeResponse>(`/git/trees/${encodeURIComponent(baseCommit.tree.sha)}?recursive=1`, "tree");
    if (!Array.isArray(treeResponse.tree) || treeResponse.truncated) throw new ArtifactRepositoryContentError();
    const artifacts = await this.artifactsFromTree(treeResponse.tree, "proposal");
    const artifact = artifacts.find((candidate) => candidate.id === input.id);
    if (!artifact) throw new ArtifactNotFoundError();
    if (validateArtifactPath(artifact.path, this.rootPath)) throw new ArtifactRepositoryContentError();
    const entry = treeResponse.tree.find((candidate) => candidate.type === "blob" && candidate.path === artifact.path);
    if (!entry?.sha) throw new ArtifactRepositoryContentError();
    if (entry.sha !== input.currentFileSha) throw new ArtifactWriteConflictError();

    validateImmutableLifecycleMetadata(artifact, metadata);

    const existingRef = await this.optionalGitHubGet<{ object?: { sha?: string } }>(`/git/ref/heads/${branchName.split("/").map(encodeURIComponent).join("/")}`);
    if (existingRef) return this.resolveExistingProposal(input.id, branchName, artifact.path, markdown, existingRef.object?.sha);

    const blob = await this.githubWrite<{ sha?: string }>("/git/blobs", { content: markdown, encoding: "utf-8" });
    if (!blob.sha) throw new ArtifactWriteResponseError();
    const tree = await this.githubWrite<{ sha?: string }>("/git/trees", { base_tree: baseCommit.tree.sha, tree: [{ path: artifact.path, mode: "100644", type: "blob", sha: blob.sha }] });
    if (!tree.sha) throw new ArtifactWriteResponseError();
    const commit = await this.githubWrite<{ sha?: string }>("/git/commits", { message: `Propose update to artifact ${input.id} (requested by @${input.actorLogin})`, tree: tree.sha, parents: [baseCommitSha] });
    if (!commit.sha) throw new ArtifactWriteResponseError();
    await this.githubWrite("/git/refs", { ref: `refs/heads/${branchName}`, sha: commit.sha });
    try {
      const pull = await this.createPullRequest(branchName, metadata.title, input, artifact.path);
      return { artifactId: input.id, path: artifact.path, branchName, commitSha: commit.sha, pullRequestNumber: pull.number, pullRequestUrl: pull.html_url };
    } catch (error) {
      if (error instanceof ArtifactProposalPermissionError || error instanceof ArtifactRepositoryUnavailableError || error instanceof ArtifactWriteResponseError) {
        throw new ArtifactProposalIncompleteError(branchName, this.branchHtmlUrl(branchName));
      }
      throw error;
    }
  }

  private branchHtmlUrl(branchName: string) { return `https://github.com/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/tree/${branchName.split("/").map(encodeURIComponent).join("/")}`; }

  private async resolveExistingProposal(artifactId: string, branchName: string, artifactPath: string, markdown: string, commitSha?: string): Promise<ArtifactProposalResult> {
    if (!commitSha) throw new ArtifactProposalCollisionError();
    const tree = await this.githubGet<GitHubTreeResponse>(`/git/trees/${encodeURIComponent(commitSha)}?recursive=1`, "tree");
    const entry = tree.tree?.find((candidate) => candidate.type === "blob" && candidate.path === artifactPath);
    if (!entry?.sha) throw new ArtifactProposalCollisionError();
    const expectedSha = createHash("sha1").update(`blob ${Buffer.byteLength(markdown)}\0${markdown}`).digest("hex");
    if (entry.sha !== expectedSha) throw new ArtifactProposalCollisionError();
    const pulls = await this.githubGet<unknown[]>(`/pulls?state=open&head=${encodeURIComponent(`${this.config.owner}:${branchName}`)}&base=${encodeURIComponent(this.branch)}`, "tree");
    const parsed = z.array(z.object({ number: z.number().int().positive(), html_url: z.string().url(), head: z.object({ ref: z.string() }), base: z.object({ ref: z.string() }) })).safeParse(pulls);
    const pull = parsed.success ? parsed.data.find((candidate) => candidate.head.ref === branchName && candidate.base.ref === this.branch) : undefined;
    if (!pull || !pull.html_url.startsWith("https://github.com/")) throw new ArtifactProposalCollisionError();
    return { artifactId, path: artifactPath, branchName, commitSha, pullRequestNumber: pull.number, pullRequestUrl: pull.html_url };
  }

  private async resolveExistingDeletionProposal(artifactId: string, branchName: string, artifactPath: string, sourceFileSha: string, baseCommitSha: string, baseTreeSha: string, commitSha?: string): Promise<ArtifactProposalResult> {
    if (!commitSha) throw new ArtifactProposalCollisionError();
    const commit = await this.githubGet<{ tree?: { sha?: string }; parents?: { sha?: string }[] }>(`/git/commits/${encodeURIComponent(commitSha)}`, "tree");
    if (commit.parents?.length !== 1 || commit.parents[0]?.sha !== baseCommitSha || !commit.tree?.sha) throw new ArtifactProposalCollisionError();
    const baseTree = await this.githubGet<GitHubTreeResponse>(`/git/trees/${encodeURIComponent(baseTreeSha)}?recursive=1`, "tree");
    const proposalTree = await this.githubGet<GitHubTreeResponse>(`/git/trees/${encodeURIComponent(commit.tree.sha)}?recursive=1`, "tree");
    if (!Array.isArray(baseTree.tree) || !Array.isArray(proposalTree.tree) || baseTree.truncated || proposalTree.truncated) throw new ArtifactProposalCollisionError();
    const source = baseTree.tree.find((entry) => entry.type === "blob" && entry.path === artifactPath);
    if (source?.sha !== sourceFileSha) throw new ArtifactProposalCollisionError();
    const withoutTarget = (entries: GitHubTreeEntry[]) => entries.filter((entry) => entry.type === "blob" && entry.path !== artifactPath).map((entry) => `${entry.path}\0${entry.mode}\0${entry.type}\0${entry.sha}`).sort();
    if (proposalTree.tree.some((entry) => entry.path === artifactPath) || JSON.stringify(withoutTarget(baseTree.tree)) !== JSON.stringify(withoutTarget(proposalTree.tree))) throw new ArtifactProposalCollisionError();
    const pulls = await this.githubGet<unknown[]>(`/pulls?state=open&head=${encodeURIComponent(`${this.config.owner}:${branchName}`)}&base=${encodeURIComponent(this.branch)}`, "tree");
    const parsed = z.array(z.object({ number: z.number().int().positive(), html_url: z.string().url(), head: z.object({ ref: z.string() }), base: z.object({ ref: z.string() }) })).safeParse(pulls);
    const pull = parsed.success ? parsed.data.find((candidate) => candidate.head.ref === branchName && candidate.base.ref === this.branch) : undefined;
    if (!pull || !pull.html_url.startsWith("https://github.com/")) throw new ArtifactProposalCollisionError();
    return { artifactId, path: artifactPath, branchName, commitSha, pullRequestNumber: pull.number, pullRequestUrl: pull.html_url };
  }

  private async resolveDeletion(input: DeleteArtifactInput, capability: RepositoryCredentialCapability) {
    if (!/^[A-Za-z0-9-]+$/.test(input.actorLogin) || !input.currentFileSha.trim()) throw new ArtifactWriteValidationError();
    const tree = await this.fetchTree(capability);
    const artifacts = await this.artifactsFromTree(tree, capability);
    const artifact = artifacts.find((candidate) => candidate.id === input.id);
    if (!artifact) throw new ArtifactNotFoundError();
    if (validateArtifactPath(artifact.path, this.rootPath)) throw new ArtifactRepositoryContentError();
    const entry = tree.find((candidate) => candidate.type === "blob" && candidate.path === artifact.path);
    if (!entry?.sha) throw new ArtifactRepositoryContentError();
    if (entry.sha !== input.currentFileSha) throw new ArtifactWriteConflictError();
    return { artifact, path: artifact.path };
  }

  private async deleteContents(filePath: string, input: DeleteArtifactInput): Promise<ArtifactDeleteResult> {
    let credential: string;
    try { credential = await this.credential("write"); } catch (error) { if (error instanceof ArtifactWritePermissionError) throw error; throw new ArtifactWriteAuthenticationError(); }
    let response: Response;
    try { response = await this.fetchImpl(this.githubUrl(`/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`), { method: "DELETE", headers: { accept: "application/vnd.github+json", authorization: `Bearer ${credential}`, "content-type": "application/json", "user-agent": "artifact-dev-toolkit", "x-github-api-version": "2022-11-28" }, body: JSON.stringify({ message: `Delete artifact ${input.id} (requested by @${input.actorLogin})`, sha: input.currentFileSha, branch: this.branch }) }); }
    catch { throw new ArtifactRepositoryUnavailableError(); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401) throw new ArtifactWriteAuthenticationError();
      if (response.status === 403) throw new ArtifactWritePermissionError();
      if (response.status === 404 || response.status === 409 || response.status === 422) throw new ArtifactWriteConflictError();
      if (response.status === 429 || response.status >= 500) throw new ArtifactRepositoryUnavailableError(response.status);
      throw new ArtifactWriteResponseError();
    }
    let value: unknown; try { value = await response.json(); } catch { throw new ArtifactWriteResponseError(); }
    const parsed = z.object({ content: z.null(), commit: z.object({ sha: z.string().min(1), html_url: z.string().url() }) }).safeParse(value);
    if (!parsed.success || !parsed.data.commit.html_url.startsWith("https://github.com/")) throw new ArtifactWriteResponseError();
    return { artifactId: input.id, path: filePath, commitSha: parsed.data.commit.sha, commitUrl: parsed.data.commit.html_url, repositoryRevision: parsed.data.commit.sha };
  }

  private async createPullRequest(branchName: string, title: string, input: ProposeArtifactUpdateInput, artifactPath: string) {
    const body = [`Artifact ID: ${input.id}`, `Artifact path: ${artifactPath}`, `Source file SHA: ${input.currentFileSha}`, `Requested by: @${input.actorLogin}`, "The source branch was generated by Artifact Library.", "Artifact Library will not merge this proposal automatically."].join("\n\n");
    const value = await this.githubWrite<unknown>("/pulls", { title: `Update artifact: ${title}`, head: branchName, base: this.branch, body });
    const parsed = z.object({ number: z.number().int().positive(), html_url: z.string().url() }).safeParse(value);
    if (!parsed.success || !parsed.data.html_url.startsWith("https://github.com/")) throw new ArtifactWriteResponseError();
    return parsed.data;
  }

  private async createValidatedArtifactAtPath(input: { metadata: ArtifactMetadata; body: string; path: string; actorLogin: string; commitMessage: string; prepared?: ReturnType<typeof prepareArtifactWrite> }): Promise<ArtifactWriteResult> {
    const { metadata, markdown } = input.prepared ?? prepareArtifactWrite(input.metadata, input.body);
    if (validateArtifactPath(input.path, this.rootPath)) throw new ArtifactWriteValidationError();
    const tree = await this.fetchTree("write");
    if (tree.some((entry) => entry.type === "blob" && entry.path === input.path)) throw new ArtifactDuplicateError();
    const artifacts = await this.artifactsFromTree(tree, "write");
    if (artifacts.some((artifact) => artifact.id === metadata.id)) throw new ArtifactDuplicateError();
    return this.writeContents(input.path, metadata.id, markdown, input.commitMessage, undefined);
  }

  private githubUrl(pathname: string) {
    return `${githubApiBaseUrl}/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}${pathname}`;
  }

  private githubGet<T>(pathname: string, operation: "tree" | "blob") { return this.githubJson<T>(this.githubUrl(pathname), operation, undefined, "proposal"); }

  private async optionalGitHubGet<T>(pathname: string): Promise<T | undefined> {
    let credential: string;
    try { credential = await this.credential("proposal"); } catch (error) { if (error instanceof ArtifactProposalPermissionError) throw error; throw new ArtifactRepositoryUnavailableError(); }
    let response: Response;
    try { response = await this.fetchImpl(this.githubUrl(pathname), { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${credential}`, "user-agent": "artifact-dev-toolkit", "x-github-api-version": "2022-11-28" } }); }
    catch { throw new ArtifactRepositoryUnavailableError(); }
    if (response.status === 404) { await response.body?.cancel().catch(() => undefined); return undefined; }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) throw new ArtifactProposalPermissionError();
      if (response.status === 429 || response.status >= 500) throw new ArtifactRepositoryUnavailableError(response.status);
      throw new ArtifactWriteResponseError();
    }
    try { return await response.json() as T; } catch { throw new ArtifactWriteResponseError(); }
  }

  private async githubWrite<T = unknown>(pathname: string, body: unknown): Promise<T> {
    let credential: string;
    try { credential = await this.credential("proposal"); } catch (error) { if (error instanceof ArtifactProposalPermissionError) throw error; throw new ArtifactRepositoryUnavailableError(); }
    let response: Response;
    try { response = await this.fetchImpl(this.githubUrl(pathname), { method: "POST", headers: { accept: "application/vnd.github+json", authorization: `Bearer ${credential}`, "content-type": "application/json", "user-agent": "artifact-dev-toolkit", "x-github-api-version": "2022-11-28" }, body: JSON.stringify(body) }); }
    catch { throw new ArtifactRepositoryUnavailableError(); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) throw new ArtifactProposalPermissionError();
      if (response.status === 409 || response.status === 422) throw new ArtifactProposalCollisionError();
      if (response.status === 429 || response.status >= 500) throw new ArtifactRepositoryUnavailableError(response.status);
      throw new ArtifactWriteResponseError();
    }
    try { return await response.json() as T; } catch { throw new ArtifactWriteResponseError(); }
  }

  private artifactPath(metadata: ArtifactMetadata) {
    return `${this.rootPath}/${artifactTypeDirectories[metadata.type]}/${metadata.id}.md`;
  }

  private async artifactsFromTree(tree: GitHubTreeEntry[], capability: RepositoryCredentialCapability) {
    const prefix = `${this.rootPath}/`;
    const files = tree.filter((entry) => entry.type === "blob" && entry.path?.startsWith(prefix) && entry.path.endsWith(".md"));
    const artifacts = await mapWithConcurrency(files, githubBlobConcurrency, async (file) => {
      if (!file.path || !file.sha) throw new ArtifactRepositoryContentError();
      if (validateArtifactPath(file.path, this.rootPath)) throw new ArtifactRepositoryContentError();
      try { return parseArtifactMarkdown(await this.fetchBlob(file.sha, file.path, capability), file.path); } catch (error) { if (error instanceof ArtifactMarkdownParseError) throw new ArtifactRepositoryContentError(); throw error; }
    });
    validateUniqueArtifactIds(artifacts);
    return artifacts;
  }

  private async writeContents(filePath: string, artifactId: string, markdown: string, commitMessage: string, sha?: string): Promise<ArtifactWriteResult> {
    let credential: string;
    try { credential = await this.credential("write"); }
    catch (error) {
      if (error instanceof ArtifactWritePermissionError) throw error;
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
        body: JSON.stringify({ message: commitMessage, content: Buffer.from(markdown).toString("base64"), branch: this.branch, ...(sha ? { sha } : {}) }),
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

  private async credential(capability: RepositoryCredentialCapability): Promise<string> {
    let promise = this.credentialPromises.get(capability);
    if (!promise) {
      promise = this.config.credentialProvider(capability).then((credential) => {
        const contentsAllowed = capability === "read"
          ? credential.permissions.contents === "read" || credential.permissions.contents === "write"
          : credential.permissions.contents === "write";
        const pullRequestsAllowed = capability !== "proposal" || credential.permissions.pullRequests === "write";
        if (!contentsAllowed || !pullRequestsAllowed) {
          if (capability === "proposal") throw new ArtifactProposalPermissionError();
          if (capability === "write") throw new ArtifactWritePermissionError();
          throw new ArtifactRepositoryAccessError();
        }
        return credential.token;
      });
      this.credentialPromises.set(capability, promise);
    }
    return promise;
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

  private async githubJson<T>(url: string, operation: "tree" | "blob", filePath?: string, capability: RepositoryCredentialCapability = "read", notFound: "branch" | "content" | "repository" = "content"): Promise<T> {
    let credential: string;
    try {
      credential = await this.credential(capability);
    } catch (error) {
      if (error instanceof ArtifactWritePermissionError || error instanceof ArtifactProposalPermissionError || error instanceof ArtifactRepositoryAccessError) throw error;
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
        if (response.status === 404 && url.includes("/git/ref/heads/")) throw new ArtifactBranchNotFoundError();
        if (response.status === 404 && operation === "blob" && filePath) throw new ArtifactBlobDiagnosticError("blob_unavailable");
        if (response.status === 404 && notFound === "branch") throw new ArtifactBranchNotFoundError();
        if (response.status === 404 && notFound === "repository") throw new ArtifactRepositoryNotFoundError();
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

  private async fetchTree(capability: RepositoryCredentialCapability, revision = this.branch) {
    const tree = await this.githubJson<GitHubTreeResponse>(this.githubUrl(`/git/trees/${encodeURIComponent(revision)}?recursive=1`), "tree", undefined, capability, revision === this.branch ? "branch" : "content");
    if (!Array.isArray(tree.tree)) throw new Error("GitHub artifact repository tree response was malformed.");
    if (tree.truncated) throw new Error("GitHub artifact repository tree response was truncated; reduce repository size or artifact root scope.");
    return tree.tree;
  }

  private async fetchBlob(sha: string, filePath: string, capability: RepositoryCredentialCapability) {
    const blob = await this.githubJson<GitHubBlobResponse>(this.githubUrl(`/git/blobs/${encodeURIComponent(sha)}`), "blob", filePath, capability);
    if (typeof blob.size === "number" && blob.size > MAX_SERIALIZED_ARTIFACT_BYTES) {
      throw new ArtifactBlobDiagnosticError("blob_too_large");
    }
    if (blob.encoding !== "base64" || typeof blob.content !== "string") {
      throw new ArtifactBlobDiagnosticError("unsupported_encoding");
    }
    const normalized = blob.content.replace(/\s+/g, "");
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.byteLength > MAX_SERIALIZED_ARTIFACT_BYTES) throw new ArtifactBlobDiagnosticError("blob_too_large");
    return decoded.toString("utf8");
  }
}

class ArtifactBlobDiagnosticError extends ArtifactRepositoryContentError { readonly code: "unsupported_encoding" | "blob_too_large" | "blob_unavailable"; constructor(code: "unsupported_encoding" | "blob_too_large" | "blob_unavailable") { super(); this.code = code; } }


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
  return new GitHubArtifactRepository({ owner: access.owner, repo: access.repo, branch, rootPath, credentialProvider: access.installationCredentialProvider });
}
