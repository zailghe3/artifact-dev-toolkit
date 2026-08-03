export type CacheInvalidationIdentity = { repositoryId: number; owner: string; repo: string };

export async function completeWriteWithInvalidation<T>(write: () => Promise<T>, invalidateCache: () => Promise<unknown>, identity: CacheInvalidationIdentity, logger: Pick<Console, "error"> = console): Promise<T> {
  const result = await write();
  try { await invalidateCache(); }
  catch { logger.error(JSON.stringify({ event: "artifact_catalogue_cache_invalidation_failure", repositoryId: identity.repositoryId, owner: identity.owner, repository: identity.repo, category: "cache_unavailable" })); }
  return result;
}
