import { deploymentComponentImpact } from "./deployment-component-impact.js";
import { resolveObservedComponentFreshness } from "./live-component-freshness.ts";

const FULL_SHA = /^[0-9a-f]{40}$/i;
export const MAX_RELEVANT_COMMIT_LOOKUPS = 8;

export async function resolveComponentFromGitHubEvidence(
  component: "worker" | "runtime",
  deployedRevision: string | undefined,
  signal: AbortSignal,
  loadHead: (signal: AbortSignal) => Promise<string | undefined>,
  loadComparison: (deployedRevision: string, headRevision: string, signal: AbortSignal) => Promise<unknown | undefined>,
  loadCommit: (sha: string, signal: AbortSignal) => Promise<unknown | undefined>,
) {
  const result = await resolveObservedComponentFreshness(component, deployedRevision, signal, loadHead, loadComparison);
  if (result.state !== "superseded" || !result.sourceHeadRevision || signal.aborted) return result;
  let comparison: unknown;
  try { comparison = await loadComparison(deployedRevision!, result.sourceHeadRevision, signal); } catch { return result; }
  const commits = comparison && typeof comparison === "object" && Array.isArray((comparison as { commits?: unknown }).commits)
    ? (comparison as { commits: unknown[] }).commits : [];
  if (!commits.length || commits.length > MAX_RELEVANT_COMMIT_LOOKUPS) return result;
  for (const entry of [...commits].reverse()) {
    const sha = entry && typeof entry === "object" && typeof (entry as { sha?: unknown }).sha === "string" ? (entry as { sha: string }).sha.toLowerCase() : undefined;
    if (!sha || !FULL_SHA.test(sha)) return result;
    let detail: unknown;
    try { detail = await loadCommit(sha, signal); } catch { return result; }
    const files = detail && typeof detail === "object" && Array.isArray((detail as { files?: unknown }).files) ? (detail as { files: Array<{ filename?: unknown; previous_filename?: unknown }> }).files : undefined;
    if (!files) return result;
    const paths = files.flatMap(file => [file.filename, file.previous_filename]).filter((path): path is string => typeof path === "string" && path.length > 0);
    if (deploymentComponentImpact(paths)[component]) return { ...result, latestRelevantRevision: sha };
  }
  return result;
}
