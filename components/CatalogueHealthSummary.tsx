import { DiagnosticStatusBadge } from "@/components/DiagnosticStatusBadge";
import { LocalizedTime } from "@/components/LocalizedTime";
import { cacheStatusPresentation } from "@/lib/diagnostics-presentation";
import type { RepositoryDiagnostics } from "@/lib/repository-diagnostics";

export function CatalogueHealthSummary({ cache }: { cache: RepositoryDiagnostics["cache"] }) {
  return <div className="space-y-2"><p className="flex items-center gap-2"><b>Catalogue state:</b> <DiagnosticStatusBadge presentation={cacheStatusPresentation(cache.state)} /></p><p>Last successful refresh: {cache.refreshedAt ? <LocalizedTime value={cache.refreshedAt} /> : "unknown"}</p>{cache.state === "stale" ? <p role="alert" className="font-semibold text-amber-700 dark:text-amber-300">GitHub is temporarily unavailable. Stale catalogue content is being served.</p> : null}{cache.state === "degraded" ? <p role="status" className="font-semibold text-amber-700 dark:text-amber-300">Content is fresh from GitHub, but catalogue caching is temporarily unavailable.</p> : null}</div>;
}
