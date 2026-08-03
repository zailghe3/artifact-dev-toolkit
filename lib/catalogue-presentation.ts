import type { CatalogueCacheState } from "./artifact-catalogue.ts";
import type { Artifact } from "./artifact-repository.ts";

export function catalogueStatusMessage(cacheState: CatalogueCacheState) {
  if (cacheState === "stale") return "GitHub is temporarily unavailable. This artifact may be older than the current repository version; submitting a change may return a conflict.";
  if (cacheState === "degraded") return "This content is fresh from GitHub, but catalogue cache persistence is temporarily unavailable.";
  return undefined;
}

export function stableRefreshTime(refreshedAt: string) { return new Date(refreshedAt).toISOString().replace("T", " ").replace(".000Z", " UTC"); }

export function localArtifactDetail(artifact: Artifact, refreshedAt: string) { return { artifact, currentFileSha: "", catalogue: { revision: "local", refreshedAt, cacheState: "refreshed" as const, cacheEnabled: false } }; }
