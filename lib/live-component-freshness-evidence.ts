import { resolveObservedComponentFreshness } from "./live-component-freshness.ts";
import type { CommitComponentImpactEvidence } from "./github-freshness-evidence.ts";

const FULL_SHA = /^[0-9a-f]{40}$/i;
export const MAX_RELEVANT_COMMIT_LOOKUPS = 8;

export async function resolveComponentFromGitHubEvidence(
  component: "worker" | "runtime",
  deployedRevision: string | undefined,
  signal: AbortSignal,
  loadHead: (signal: AbortSignal) => Promise<string | undefined>,
  loadComparison: (deployedRevision: string, headRevision: string, signal: AbortSignal) => Promise<unknown | undefined>,
  loadCommitImpact: (component: "worker" | "runtime", sha: string, signal: AbortSignal) => Promise<CommitComponentImpactEvidence>,
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
    let impact: CommitComponentImpactEvidence;
    try { impact = await loadCommitImpact(component, sha, signal); } catch { return result; }
    if (impact === "relevant") return { ...result, latestRelevantRevision: sha };
    if (impact === "incomplete") return result;
  }
  return result;
}
