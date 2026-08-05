import { stableRefreshTime } from "@/lib/catalogue-presentation";
import type { RepositoryDiagnostics } from "@/lib/repository-diagnostics";

const label = (value: string) => value.replaceAll("_", " ");

export function CatalogueHealthSummary({ cache }: { cache: RepositoryDiagnostics["cache"] }) {
  return <div className="space-y-2"><p>Catalogue state: <span>{label(cache.state)}</span></p><p>Last successful refresh: {cache.refreshedAt ? <time dateTime={cache.refreshedAt}>{stableRefreshTime(cache.refreshedAt)}</time> : "unknown"}</p>{cache.state === "stale" ? <p role="alert" className="font-semibold text-amber-700 dark:text-amber-300">GitHub is temporarily unavailable. Stale catalogue content is being served.</p> : null}{cache.state === "degraded" ? <p role="status" className="font-semibold text-amber-700 dark:text-amber-300">Content is fresh from GitHub, but catalogue caching is temporarily unavailable.</p> : null}</div>;
}
