import { z } from "zod";
import { artifactFrontMatterSchema, validateArtifactPath, validateUniqueArtifactIds } from "./artifact-contract.ts";
import { ArtifactRepositoryUnavailableError, type Artifact, type ArtifactRepository, type ArtifactWithRevision } from "./artifact-repository.ts";

export const DEFAULT_CATALOGUE_FRESHNESS_SECONDS = 300;
export const MIN_CATALOGUE_FRESHNESS_SECONDS = 30;
export const MAX_CATALOGUE_FRESHNESS_SECONDS = 3600;
const schemaVersion = 1;
const maxChunkBytes = 1_500_000;

export interface CatalogueCacheBinding {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type CatalogueIdentity = { repositoryId: number; owner: string; repository: string; branch: string; root: string };
export type ArtifactCatalogueResult = {
  artifacts: Artifact[];
  revision: string;
  refreshedAt: string;
  cacheState: "fresh" | "refreshed" | "stale";
  staleReason?: "repository_unavailable" | "rate_limited";
};

type StoredArtifact = { artifact: Artifact; fileSha: string };
type Snapshot = { revision: string; refreshedAt: string; entries: StoredArtifact[] };
const shaSchema = z.string().regex(/^[a-f0-9]{7,64}$/i);
const artifactSchema = artifactFrontMatterSchema.extend({ body: z.string(), excerpt: z.string(), path: z.string() });
const pointerSchema = z.object({ schemaVersion: z.literal(schemaVersion), repositoryId: z.number().int().positive(), owner: z.string(), repository: z.string(), branch: z.string(), root: z.string(), revision: shaSchema, refreshedAt: z.string().datetime(), chunks: z.array(z.string().min(1)).min(1) });
const chunkSchema = z.object({ schemaVersion: z.literal(schemaVersion), repositoryId: z.number().int().positive(), owner: z.string(), repository: z.string(), branch: z.string(), root: z.string(), revision: shaSchema, index: z.number().int().nonnegative(), entries: z.array(z.object({ artifact: artifactSchema, fileSha: shaSchema })) });
const flights = new Map<string, Promise<ArtifactCatalogueResult>>();

export function catalogueFreshnessSeconds(value = process.env.ARTIFACT_CATALOGUE_FRESHNESS_SECONDS) {
  if (!value) return DEFAULT_CATALOGUE_FRESHNESS_SECONDS;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(MAX_CATALOGUE_FRESHNESS_SECONDS, Math.max(MIN_CATALOGUE_FRESHNESS_SECONDS, parsed)) : DEFAULT_CATALOGUE_FRESHNESS_SECONDS;
}

function scope(identity: CatalogueIdentity) {
  return `catalogue:v${schemaVersion}:repository:${identity.repositoryId}:${encodeURIComponent(identity.owner.toLowerCase())}:${encodeURIComponent(identity.repository.toLowerCase())}:${encodeURIComponent(identity.branch)}:${encodeURIComponent(identity.root)}`;
}
function pointerKey(identity: CatalogueIdentity) { return `${scope(identity)}:current`; }
function safeLog(logger: Pick<Console, "info" | "error">, level: "info" | "error", event: string, identity: CatalogueIdentity, fields: Record<string, unknown> = {}) {
  logger[level](JSON.stringify({ event, repositoryId: identity.repositoryId, owner: identity.owner, repository: identity.repository, ...fields }));
}

export class ArtifactCatalogueService {
  private readonly options: { repository: ArtifactRepository; cache: CatalogueCacheBinding; identity: CatalogueIdentity; now?: () => Date; freshnessSeconds?: number; logger?: Pick<Console, "info" | "error"> };
  constructor(options: { repository: ArtifactRepository; cache: CatalogueCacheBinding; identity: CatalogueIdentity; now?: () => Date; freshnessSeconds?: number; logger?: Pick<Console, "info" | "error"> }) { this.options = options; }

  async list(options: { force?: boolean; full?: boolean; manual?: boolean } = {}): Promise<ArtifactCatalogueResult> {
    const key = scope(this.options.identity);
    const existing = flights.get(key);
    if (existing) return existing;
    const work = this.load(options).finally(() => flights.delete(key));
    flights.set(key, work);
    return work;
  }

  async findByIdWithRevision(id: string): Promise<ArtifactWithRevision | undefined> {
    const result = await this.list();
    const snapshot = await this.readSnapshot();
    const entry = snapshot?.revision === result.revision ? snapshot.entries.find((candidate) => candidate.artifact.id === id) : undefined;
    return entry ? { artifact: entry.artifact, currentFileSha: entry.fileSha } : undefined;
  }

  async invalidate() { await this.options.cache.delete(pointerKey(this.options.identity)); }

  private async load(options: { force?: boolean; full?: boolean; manual?: boolean }): Promise<ArtifactCatalogueResult> {
    const started = Date.now();
    const logger = this.options.logger ?? console;
    const now = (this.options.now ?? (() => new Date()))();
    const cached = await this.readSnapshot();
    if (options.manual) safeLog(logger, "info", "artifact_catalogue_manual_refresh", this.options.identity, { full: Boolean(options.full) });
    if (cached && !options.force && now.getTime() - Date.parse(cached.refreshedAt) < (this.options.freshnessSeconds ?? catalogueFreshnessSeconds()) * 1000) {
      safeLog(logger, "info", "artifact_catalogue_cache_hit", this.options.identity, { revision: cached.revision.slice(0, 12), count: cached.entries.length });
      return this.result(cached, "fresh");
    }
    if (!cached) safeLog(logger, "info", "artifact_catalogue_cache_miss", this.options.identity);
    try {
      const revision = await this.options.repository.getBaseRevision();
      if (cached && !options.full && revision === cached.revision) {
        const refreshed = { ...cached, refreshedAt: now.toISOString() };
        await this.publish(refreshed);
        safeLog(logger, "info", "artifact_catalogue_revision_unchanged", this.options.identity, { revision: revision.slice(0, 12), count: cached.entries.length });
        return this.result(refreshed, "refreshed");
      }
      const loaded = await this.options.repository.loadCatalogue(revision);
      const snapshot: Snapshot = { revision: loaded.revision, refreshedAt: now.toISOString(), entries: loaded.artifacts.map((artifact) => ({ artifact, fileSha: loaded.fileShas[artifact.id] })) };
      this.validateSnapshot(snapshot);
      await this.publish(snapshot);
      safeLog(logger, "info", "artifact_catalogue_refresh_succeeded", this.options.identity, { revision: revision.slice(0, 12), count: snapshot.entries.length, durationMs: Date.now() - started });
      return this.result(snapshot, "refreshed");
    } catch (error) {
      const temporary = error instanceof ArtifactRepositoryUnavailableError;
      safeLog(logger, "error", "artifact_catalogue_refresh_failure", this.options.identity, { category: temporary ? "temporary_unavailable" : "non_retryable", durationMs: Date.now() - started });
      if (cached && temporary) {
        const staleReason = error.status === 429 ? "rate_limited" : "repository_unavailable";
        safeLog(logger, "info", "artifact_catalogue_stale_fallback", this.options.identity, { revision: cached.revision.slice(0, 12), count: cached.entries.length, category: staleReason });
        return { ...this.result(cached, "stale"), staleReason };
      }
      throw error;
    }
  }

  private result(snapshot: Snapshot, cacheState: ArtifactCatalogueResult["cacheState"]): ArtifactCatalogueResult { return { artifacts: snapshot.entries.map((entry) => entry.artifact), revision: snapshot.revision, refreshedAt: snapshot.refreshedAt, cacheState }; }

  private validateSnapshot(snapshot: Snapshot) {
    for (const entry of snapshot.entries) {
      artifactSchema.parse(entry.artifact); shaSchema.parse(entry.fileSha);
      if (validateArtifactPath(entry.artifact.path, this.options.identity.root)) throw new Error("Invalid cached artifact path.");
    }
    validateUniqueArtifactIds(snapshot.entries.map((entry) => entry.artifact));
  }

  private async readSnapshot(): Promise<Snapshot | undefined> {
    const logger = this.options.logger ?? console;
    const raw = await this.options.cache.get(pointerKey(this.options.identity));
    if (!raw) return undefined;
    try {
      const pointer = pointerSchema.parse(JSON.parse(raw));
      const id = this.options.identity;
      if (pointer.repositoryId !== id.repositoryId || pointer.owner.toLowerCase() !== id.owner.toLowerCase() || pointer.repository.toLowerCase() !== id.repository.toLowerCase() || pointer.branch !== id.branch || pointer.root !== id.root) throw new Error("identity mismatch");
      const chunks = await Promise.all(pointer.chunks.map(async (key, index) => {
        const value = await this.options.cache.get(key); if (!value) throw new Error("missing chunk");
        const chunk = chunkSchema.parse(JSON.parse(value));
        if (chunk.repositoryId !== id.repositoryId || chunk.owner.toLowerCase() !== id.owner.toLowerCase() || chunk.repository.toLowerCase() !== id.repository.toLowerCase() || chunk.branch !== id.branch || chunk.root !== id.root || chunk.revision !== pointer.revision || chunk.index !== index) throw new Error("chunk mismatch");
        return chunk.entries;
      }));
      const snapshot = { revision: pointer.revision, refreshedAt: pointer.refreshedAt, entries: chunks.flat() };
      this.validateSnapshot(snapshot); return snapshot;
    } catch {
      safeLog(logger, "error", "artifact_catalogue_cache_corruption", this.options.identity, { category: "invalid_entry" });
      return undefined;
    }
  }

  private async publish(snapshot: Snapshot) {
    const groups: StoredArtifact[][] = []; let current: StoredArtifact[] = [];
    for (const entry of snapshot.entries) {
      const candidate = [...current, entry];
      if (current.length && new TextEncoder().encode(JSON.stringify(candidate)).byteLength > maxChunkBytes) { groups.push(current); current = [entry]; } else current = candidate;
    }
    groups.push(current);
    const base = `${scope(this.options.identity)}:snapshot:${snapshot.revision}`;
    const keys = groups.map((_, index) => `${base}:chunk:${index}`);
    await Promise.all(groups.map((entries, index) => this.options.cache.put(keys[index], JSON.stringify({ schemaVersion, ...this.options.identity, revision: snapshot.revision, index, entries }))));
    await this.options.cache.put(pointerKey(this.options.identity), JSON.stringify({ schemaVersion, ...this.options.identity, refreshedAt: snapshot.refreshedAt, revision: snapshot.revision, chunks: keys }));
  }
}

export class MemoryCatalogueCache implements CatalogueCacheBinding {
  readonly values = new Map<string, string>();
  reads = 0;
  async get(key: string) { this.reads += 1; return this.values.get(key) ?? null; }
  async put(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}
