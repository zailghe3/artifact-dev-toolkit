import { catalogueStatusMessage, stableRefreshTime } from "@/lib/catalogue-presentation";
import type { CatalogueCacheState } from "@/lib/artifact-catalogue";

export function CatalogueStatus({ refreshedAt, cacheState }: { refreshedAt: string; cacheState: CatalogueCacheState }) {
  const message = catalogueStatusMessage(cacheState);
  if (!message) return null;
  return <aside role={cacheState === "stale" ? "alert" : "status"} className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
    <p className="font-semibold">{message}</p>
    <p className="mt-1">Last successful refresh: <time dateTime={refreshedAt}>{stableRefreshTime(refreshedAt)}</time></p>
  </aside>;
}
