import { z } from "zod";
import { artifactFrontMatterSchema, compatibleArtifactFrontMatterSchema, validateUniqueArtifactIds } from "./artifact-contract.ts";
import { classifyArtifactPath } from "./repository-layout.ts";
import { ArtifactRepositoryUnavailableError, type Artifact, type ArtifactRepository, type ArtifactWithRevision } from "./artifact-repository.ts";

export const DEFAULT_CATALOGUE_FRESHNESS_SECONDS = 300;
export const MIN_CATALOGUE_FRESHNESS_SECONDS = 30;
export const MAX_CATALOGUE_FRESHNESS_SECONDS = 3600;
const schemaVersion = 1;
const maxChunkBytes = 1_500_000;

export interface CatalogueCacheBinding { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void>; delete(key: string): Promise<void>; }
export type CatalogueIdentity = { repositoryId: number; owner: string; repository: string; branch: string; root: string };
export type CatalogueCacheState = "fresh" | "refreshed" | "stale" | "degraded";
export type ArtifactCatalogueResult = { artifacts: Artifact[]; revision: string; refreshedAt: string; cacheState: CatalogueCacheState; staleReason?: "repository_unavailable" | "rate_limited"; cacheEnabled?: boolean };
export type CatalogueCacheDiagnostic = { configured: true; state: "fresh" | "stale" | "missing" | "degraded" | "corrupt"; revision?: string; refreshedAt?: string; ageSeconds?: number; artifactCount?: number; currentRevisionMatches?: boolean | "unknown"; reason?: string };
export class CatalogueCacheUnavailableError extends Error { constructor() { super("The catalogue KV binding is unavailable."); } }
export class CatalogueSnapshotCorruptError extends Error { constructor() { super("The catalogue snapshot is corrupt."); } }
export type ResolvedCatalogue = ArtifactCatalogueResult & { fileShas: Record<string, string> };
export type ArtifactCatalogueDetail = ArtifactWithRevision & { catalogue: Omit<ArtifactCatalogueResult, "artifacts"> & { cacheEnabled: true } };
type CataloguePublicationResult = { state: "published" | "competing_publication" } | { state: "aborted"; reason: "generation_changed" | "revision_changed" } | { state: "degraded"; reason: "cache_unavailable" };
type StoredArtifact = { artifact: Artifact; fileSha: string };
type Snapshot = { revision: string; refreshedAt: string; entries: StoredArtifact[] };
type RefreshOptions = { force?: boolean; full?: boolean; manual?: boolean };
type Flight = { level: number; promise: Promise<ResolvedCatalogue> };

const shaSchema = z.string().regex(/^[a-f0-9]{7,64}$/i);
const artifactSchema = compatibleArtifactFrontMatterSchema.extend({ body: z.string(), excerpt: z.string(), path: z.string(), layout: z.enum(["legacy", "future"]).optional() });
const pointerSchema = z.object({ schemaVersion: z.literal(schemaVersion), repositoryId: z.number().int().positive(), owner: z.string(), repository: z.string(), branch: z.string(), root: z.string(), revision: shaSchema, refreshedAt: z.string().datetime(), generation: z.string().optional(), publicationId: z.string().optional(), chunks: z.array(z.string().min(1)).min(1) });
const chunkSchema = z.object({ schemaVersion: z.literal(schemaVersion), repositoryId: z.number().int().positive(), owner: z.string(), repository: z.string(), branch: z.string(), root: z.string(), revision: shaSchema, index: z.number().int().nonnegative(), entries: z.array(z.object({ artifact: artifactSchema, fileSha: shaSchema })) });
const generationSchema = z.object({ schemaVersion: z.literal(schemaVersion), generation: z.string().min(1) });
const flights = new Map<string, Flight>();
const localGenerations = new Map<string, number>();
const invalidatedScopes = new Set<string>();

export function catalogueFreshnessSeconds(value = process.env.ARTIFACT_CATALOGUE_FRESHNESS_SECONDS) { if (!value) return DEFAULT_CATALOGUE_FRESHNESS_SECONDS; const parsed = Number(value); return Number.isSafeInteger(parsed) ? Math.min(MAX_CATALOGUE_FRESHNESS_SECONDS, Math.max(MIN_CATALOGUE_FRESHNESS_SECONDS, parsed)) : DEFAULT_CATALOGUE_FRESHNESS_SECONDS; }
function scope(identity: CatalogueIdentity) { return `catalogue:v${schemaVersion}:repository:${identity.repositoryId}:${encodeURIComponent(identity.owner.toLowerCase())}:${encodeURIComponent(identity.repository.toLowerCase())}:${encodeURIComponent(identity.branch)}:${encodeURIComponent(identity.root)}`; }
function pointerKey(identity: CatalogueIdentity) { return `${scope(identity)}:current`; }
function generationKey(identity: CatalogueIdentity) { return `${scope(identity)}:generation`; }
function requestLevel(options: RefreshOptions) { return options.full ? 2 : options.force ? 1 : 0; }
function safeLog(logger: Pick<Console, "info" | "error">, level: "info" | "error", event: string, identity: CatalogueIdentity, fields: Record<string, unknown> = {}) { logger[level](JSON.stringify({ event, repositoryId: identity.repositoryId, owner: identity.owner, repository: identity.repository, ...fields })); }
function randomGeneration() { return `${Date.now().toString(36)}-${crypto.randomUUID()}`; }

export class ArtifactCatalogueService {
  private readonly options: { repository: ArtifactRepository; cache: CatalogueCacheBinding; identity: CatalogueIdentity; now?: () => Date; freshnessSeconds?: number; logger?: Pick<Console, "info" | "error"> };
  constructor(options: { repository: ArtifactRepository; cache: CatalogueCacheBinding; identity: CatalogueIdentity; now?: () => Date; freshnessSeconds?: number; logger?: Pick<Console, "info" | "error"> }) { this.options = options; }

  async list(options: RefreshOptions = {}): Promise<ArtifactCatalogueResult> { const result = await this.resolve(options); return { artifacts: result.artifacts, revision: result.revision, refreshedAt: result.refreshedAt, cacheState: result.cacheState, ...(result.staleReason ? { staleReason: result.staleReason } : {}) }; }
  async findByIdWithRevision(id: string): Promise<ArtifactCatalogueDetail | undefined> { const result = await this.resolve(); const artifact = result.artifacts.find(candidate => candidate.id === id); const currentFileSha = result.fileShas[id]; return artifact && currentFileSha ? { artifact, currentFileSha, catalogue: { revision: result.revision, refreshedAt: result.refreshedAt, cacheState: result.cacheState, ...(result.staleReason ? { staleReason: result.staleReason } : {}), cacheEnabled: true } } : undefined; }

  /** Read-only DATA-003 inspection. It deliberately returns no keys or cached entries. */
  async inspect(currentRevision?: string): Promise<CatalogueCacheDiagnostic> {
    const key = scope(this.options.identity);
    const generation = await this.readGeneration();
    const cached = await this.readSnapshot();
    if (generation.failed || cached.failed) return { configured: true, state: "degraded", reason: "cache_read_unavailable" };
    if (cached.corrupt) return { configured: true, state: "corrupt", reason: "invalid_cache_snapshot" };
    if (!cached.snapshot) return { configured: true, state: "missing" };
    if (invalidatedScopes.has(key) || cached.generation !== generation.value) return { configured: true, state: "corrupt", reason: invalidatedScopes.has(key) ? "locally_invalidated" : "generation_mismatch" };
    const snapshot = cached.snapshot;
    const ageSeconds = Math.max(0, Math.floor(((this.options.now ?? (() => new Date()))().getTime() - Date.parse(snapshot.refreshedAt)) / 1000));
    const matches = currentRevision ? currentRevision === snapshot.revision : "unknown";
    const fresh = ageSeconds < (this.options.freshnessSeconds ?? catalogueFreshnessSeconds()) && matches !== false;
    return { configured: true, state: fresh ? "fresh" : "stale", revision: snapshot.revision, refreshedAt: snapshot.refreshedAt, ageSeconds, artifactCount: snapshot.entries.length, currentRevisionMatches: matches, ...(!fresh ? { reason: matches === false ? "revision_mismatch" : "age" } : {}) };
  }

  async invalidate(): Promise<boolean> {
    const key = scope(this.options.identity); localGenerations.set(key, (localGenerations.get(key) ?? 0) + 1); invalidatedScopes.add(key);
    try {
      await this.options.cache.put(generationKey(this.options.identity), JSON.stringify({ schemaVersion, generation: randomGeneration() }));
      await this.options.cache.delete(pointerKey(this.options.identity));
      safeLog(this.logger, "info", "artifact_catalogue_invalidated", this.options.identity);
      return true;
    } catch {
      safeLog(this.logger, "error", "artifact_catalogue_cache_invalidation_failure", this.options.identity, { category: "cache_unavailable" });
      return false;
    }
  }

  private get logger() { return this.options.logger ?? console; }
  private resolve(options: RefreshOptions = {}): Promise<ResolvedCatalogue> {
    const key = scope(this.options.identity); const level = requestLevel(options); const existing = flights.get(key);
    if (existing && existing.level >= level) return existing.promise;
    if (existing) {
      const queued = existing.promise.catch(() => undefined).then(() => this.load(options));
      const finalPromise: Promise<ResolvedCatalogue> = queued.finally(() => { if (flights.get(key)?.promise === finalPromise) flights.delete(key); });
      const flight = { level, promise: finalPromise };
      flights.set(key, flight); return flight.promise;
    }
    const work = this.load(options); const finalPromise: Promise<ResolvedCatalogue> = work.finally(() => { if (flights.get(key)?.promise === finalPromise) flights.delete(key); }); flights.set(key, { level, promise: finalPromise }); return finalPromise;
  }

  private async load(options: RefreshOptions): Promise<ResolvedCatalogue> {
    const started = Date.now(); const now = (this.options.now ?? (() => new Date()))(); const key = scope(this.options.identity); const localGeneration = localGenerations.get(key) ?? 0;
    const generation = await this.readGeneration(); const cachedRead = await this.readSnapshot(); const generationMatches = cachedRead.generation === generation.value; const cached = invalidatedScopes.has(key) || !generationMatches ? undefined : cachedRead.snapshot; let degraded = generation.failed || cachedRead.failed;
    if (options.manual) safeLog(this.logger, "info", "artifact_catalogue_manual_refresh", this.options.identity, { full: Boolean(options.full) });
    if (cached && !options.force && !degraded && now.getTime() - Date.parse(cached.refreshedAt) < (this.options.freshnessSeconds ?? catalogueFreshnessSeconds()) * 1000) { safeLog(this.logger, "info", "artifact_catalogue_cache_hit", this.options.identity, { revision: cached.revision.slice(0, 12), count: cached.entries.length }); return this.result(cached, "fresh"); }
    if (!cached) safeLog(this.logger, "info", "artifact_catalogue_cache_miss", this.options.identity, { category: degraded ? "cache_unavailable" : "not_found" });
    try {
      const revision = await this.options.repository.getBaseRevision();
      let snapshot: Snapshot;
      if (cached && !options.full && revision === cached.revision) { snapshot = { ...cached, refreshedAt: now.toISOString() }; safeLog(this.logger, "info", "artifact_catalogue_revision_unchanged", this.options.identity, { revision: revision.slice(0, 12), count: cached.entries.length }); }
      else { const loaded = await this.options.repository.loadCatalogue(revision); snapshot = { revision: loaded.revision, refreshedAt: now.toISOString(), entries: loaded.artifacts.map(artifact => ({ artifact, fileSha: loaded.fileShas[artifact.id] })) }; this.validateSnapshot(snapshot); }
      const publication = await this.publish(snapshot, generation.value, localGeneration);
      degraded ||= publication.state === "degraded" || publication.state === "aborted";
      safeLog(this.logger, "info", "artifact_catalogue_refresh_succeeded", this.options.identity, { revision: revision.slice(0, 12), count: snapshot.entries.length, durationMs: Date.now() - started, cache: degraded ? "degraded" : publication.state });
      return this.result(snapshot, degraded ? "degraded" : "refreshed");
    } catch (error) {
      const temporary = error instanceof ArtifactRepositoryUnavailableError; safeLog(this.logger, "error", "artifact_catalogue_refresh_failure", this.options.identity, { category: temporary ? "temporary_unavailable" : "non_retryable", durationMs: Date.now() - started });
      if (cached && temporary) { const staleReason = error.status === 429 ? "rate_limited" : "repository_unavailable"; safeLog(this.logger, "info", "artifact_catalogue_stale_fallback", this.options.identity, { revision: cached.revision.slice(0, 12), count: cached.entries.length, category: staleReason }); return { ...this.result(cached, "stale"), staleReason }; }
      throw error;
    }
  }

  private result(snapshot: Snapshot, cacheState: CatalogueCacheState): ResolvedCatalogue { return { artifacts: snapshot.entries.map(entry => entry.artifact), fileShas: Object.fromEntries(snapshot.entries.map(entry => [entry.artifact.id, entry.fileSha])), revision: snapshot.revision, refreshedAt: snapshot.refreshedAt, cacheState }; }
  private validateSnapshot(snapshot: Snapshot) { shaSchema.parse(snapshot.revision); for (const entry of snapshot.entries) { const parsed = artifactSchema.parse(entry.artifact); shaSchema.parse(entry.fileSha); const layout = classifyArtifactPath(parsed.path, this.options.identity.root); if (!layout || !parsed.path.replace(/\\/g, "/").endsWith(".md")) throw new Error("Invalid cached artifact path."); if (parsed.layout && parsed.layout !== layout) throw new Error("Cached artifact layout contradicts its path."); (layout === "legacy" ? artifactFrontMatterSchema : compatibleArtifactFrontMatterSchema).parse(parsed); } validateUniqueArtifactIds(snapshot.entries.map(entry => entry.artifact)); }
  private async readGeneration(): Promise<{ value?: string; failed: boolean }> { try { const raw = await this.options.cache.get(generationKey(this.options.identity)); if (!raw) return { failed: false }; return { value: generationSchema.parse(JSON.parse(raw)).generation, failed: false }; } catch { safeLog(this.logger, "error", "artifact_catalogue_cache_read_failure", this.options.identity, { category: "generation_read" }); return { failed: true }; } }
  private async readSnapshot(): Promise<{ snapshot?: Snapshot; generation?: string; publicationId?: string; failed: boolean; corrupt?: boolean }> {
    let raw: string | null; try { raw = await this.options.cache.get(pointerKey(this.options.identity)); } catch { safeLog(this.logger, "error", "artifact_catalogue_cache_read_failure", this.options.identity, { category: "pointer_read" }); return { failed: true }; }
    if (!raw) return { failed: false };
    try {
      const pointer = pointerSchema.parse(JSON.parse(raw)); const id = this.options.identity; if (pointer.repositoryId !== id.repositoryId || pointer.owner.toLowerCase() !== id.owner.toLowerCase() || pointer.repository.toLowerCase() !== id.repository.toLowerCase() || pointer.branch !== id.branch || pointer.root !== id.root) throw new Error("identity mismatch");
      const chunks = await Promise.all(pointer.chunks.map(async (chunkKey, index) => { let value: string | null; try { value = await this.options.cache.get(chunkKey); } catch { throw new CatalogueChunkReadError(); } if (!value) throw new Error("missing chunk"); const chunk = chunkSchema.parse(JSON.parse(value)); if (chunk.repositoryId !== id.repositoryId || chunk.owner.toLowerCase() !== id.owner.toLowerCase() || chunk.repository.toLowerCase() !== id.repository.toLowerCase() || chunk.branch !== id.branch || chunk.root !== id.root || chunk.revision !== pointer.revision || chunk.index !== index) throw new Error("chunk mismatch"); return chunk.entries; }));
      const snapshot = { revision: pointer.revision, refreshedAt: pointer.refreshedAt, entries: chunks.flat() }; this.validateSnapshot(snapshot); return { snapshot, generation: pointer.generation, publicationId: pointer.publicationId, failed: false };
    } catch (error) { if (error instanceof CatalogueChunkReadError) { safeLog(this.logger, "error", "artifact_catalogue_cache_read_failure", this.options.identity, { category: "chunk_read" }); return { failed: true }; } safeLog(this.logger, "error", "artifact_catalogue_cache_corruption", this.options.identity, { category: "invalid_entry" }); return { failed: false, corrupt: true }; }
  }
  private async publish(snapshot: Snapshot, startingGeneration: string | undefined, startingLocalGeneration: number): Promise<CataloguePublicationResult> {
    const groups: StoredArtifact[][] = []; let current: StoredArtifact[] = [];
    for (const entry of snapshot.entries) { const candidate = [...current, entry]; if (current.length && new TextEncoder().encode(JSON.stringify(candidate)).byteLength > maxChunkBytes) { groups.push(current); current = [entry]; } else current = candidate; } groups.push(current);
    const base = `${scope(this.options.identity)}:snapshot:${snapshot.revision}`; const keys = groups.map((_, index) => `${base}:chunk:${index}`); const publicationId = crypto.randomUUID();
    try { await Promise.all(groups.map((entries, index) => this.options.cache.put(keys[index], JSON.stringify({ schemaVersion, ...this.options.identity, revision: snapshot.revision, index, entries })))); }
    catch { return this.recoverCachePublication(snapshot, startingGeneration, publicationId, false); }
    const currentGeneration = await this.readGeneration(); const localGeneration = localGenerations.get(scope(this.options.identity)) ?? 0;
    if (currentGeneration.failed) return { state: "degraded", reason: "cache_unavailable" };
    if (currentGeneration.value !== startingGeneration || localGeneration !== startingLocalGeneration) { safeLog(this.logger, "error", "artifact_catalogue_publish_aborted", this.options.identity, { category: "generation_changed", revision: snapshot.revision.slice(0, 12) }); return { state: "aborted", reason: "generation_changed" }; }
    const preVerification = await this.verifyBaseRevision(snapshot, publicationId, false);
    if (preVerification) return preVerification;
    try { await this.options.cache.put(pointerKey(this.options.identity), JSON.stringify({ schemaVersion, ...this.options.identity, refreshedAt: snapshot.refreshedAt, revision: snapshot.revision, generation: startingGeneration, publicationId, chunks: keys })); }
    catch { return this.recoverCachePublication(snapshot, startingGeneration, publicationId, true); }
    const postVerification = await this.verifyBaseRevision(snapshot, publicationId, true);
    if (postVerification) return postVerification;
    invalidatedScopes.delete(scope(this.options.identity)); return { state: "published" };
  }
  private async verifyBaseRevision(snapshot: Snapshot, publicationId: string, pointerPublished: boolean): Promise<CataloguePublicationResult | undefined> {
    let revision: string;
    try { revision = await this.options.repository.getBaseRevision(); }
    catch (error) { if (pointerPublished) await this.cleanupUnverifiedPublication(snapshot, publicationId); if (error instanceof ArtifactRepositoryUnavailableError) { safeLog(this.logger, "error", "artifact_catalogue_publish_aborted", this.options.identity, { category: "repository_unavailable", revision: snapshot.revision.slice(0, 12) }); return { state: "degraded", reason: "cache_unavailable" }; } throw error; }
    if (revision === snapshot.revision) return undefined;
    if (pointerPublished) await this.cleanupUnverifiedPublication(snapshot, publicationId); safeLog(this.logger, "error", "artifact_catalogue_publish_aborted", this.options.identity, { category: "revision_changed", revision: snapshot.revision.slice(0, 12) }); return { state: "aborted", reason: "revision_changed" };
  }
  private async recoverCachePublication(snapshot: Snapshot, generation: string | undefined, publicationId: string, pointerAttempted: boolean): Promise<CataloguePublicationResult> {
    safeLog(this.logger, "error", "artifact_catalogue_cache_publication_failure", this.options.identity, { category: "cache_unavailable", revision: snapshot.revision.slice(0, 12) }); const competing = await this.readSnapshot();
    if (competing.publicationId !== publicationId && competing.snapshot?.revision === snapshot.revision && competing.generation === generation && Date.parse(competing.snapshot.refreshedAt) >= Date.parse(snapshot.refreshedAt)) return { state: "competing_publication" };
    if (pointerAttempted) await this.cleanupUnverifiedPublication(snapshot, publicationId);
    return { state: "degraded", reason: "cache_unavailable" };
  }
  private async cleanupUnverifiedPublication(snapshot: Snapshot, publicationId: string) {
    const key = scope(this.options.identity); localGenerations.set(key, (localGenerations.get(key) ?? 0) + 1); invalidatedScopes.add(key);
    try { await this.options.cache.put(generationKey(this.options.identity), JSON.stringify({ schemaVersion, generation: randomGeneration() })); }
    catch { safeLog(this.logger, "error", "artifact_catalogue_verification_cleanup_failure", this.options.identity, { category: "generation_write" }); }
    try { const visible = await this.readSnapshot(); const demonstrablyNewer = visible.publicationId !== publicationId && visible.snapshot && Date.parse(visible.snapshot.refreshedAt) > Date.parse(snapshot.refreshedAt); if (!demonstrablyNewer) await this.options.cache.delete(pointerKey(this.options.identity)); }
    catch { safeLog(this.logger, "error", "artifact_catalogue_verification_cleanup_failure", this.options.identity, { category: "pointer_delete" }); }
  }
}

class CatalogueChunkReadError extends Error {}

export class MemoryCatalogueCache implements CatalogueCacheBinding { readonly values = new Map<string, string>(); reads = 0; async get(key: string) { this.reads++; return this.values.get(key) ?? null; } async put(key: string, value: string) { this.values.set(key, value); } async delete(key: string) { this.values.delete(key); } }
