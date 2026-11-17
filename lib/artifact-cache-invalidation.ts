import type { ArtifactOperationCategory } from "./artifact-operation.ts";
export type CacheInvalidationIdentity = { repositoryId: number; owner: string; repo: string; operationId?: string; operation?: ArtifactOperationCategory };

export async function completeWriteWithInvalidation<T>(write: () => Promise<T>, invalidateCache: () => Promise<unknown>, identity: CacheInvalidationIdentity, logger: Pick<Console, "error"> = console): Promise<T> {
  const result = await write();
  const started = Date.now();
  try { await invalidateCache(); }
  catch { logger.error(JSON.stringify({ event: "artifact_catalogue_cache_invalidation_failure", operationId: identity.operationId, operation: identity.operation, stage: "cache_invalidation", mutation: "committed", elapsedMs: Date.now() - started, category: "cache_unavailable" })); }
  return result;
}
