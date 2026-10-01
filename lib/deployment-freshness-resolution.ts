import {
  deploymentComponentImpact,
  hasUnclassifiedDeploymentChanges,
} from "./deployment-component-impact.js";
import type { InfrastructureComponent, InfrastructureComponentFreshness } from "./infrastructure-freshness.ts";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const GITHUB_MAX_SAFE_FILES = 299;

type CompareFile = { filename?: unknown; previous_filename?: unknown };
type CompareView = { status?: unknown; files?: unknown; head_commit?: unknown };

export function latestRelevantRevisionFromCommits(
  component: InfrastructureComponent,
  commitsNewestFirst: Array<{ sha: string; files: CompareFile[] }>,
): string | undefined {
  for (const commit of commitsNewestFirst) {
    const sha = commit.sha.toLowerCase();
    if (!FULL_SHA.test(sha) || !Array.isArray(commit.files)) return undefined;
    const paths: string[] = [];
    for (const file of commit.files) {
      if (!file || typeof file.filename !== "string" || !file.filename) return undefined;
      paths.push(file.filename);
      if (typeof file.previous_filename === "string" && file.previous_filename) paths.push(file.previous_filename);
    }
    if (deploymentComponentImpact(paths)[component]) return sha;
  }
  return undefined;
}

function headRevision(value: CompareView): string | undefined {
  if (!value.head_commit || typeof value.head_commit !== "object" || Array.isArray(value.head_commit)) return undefined;
  const sha = (value.head_commit as Record<string, unknown>).sha;
  return typeof sha === "string" && FULL_SHA.test(sha) ? sha.toLowerCase() : undefined;
}

export function resolveComponentFreshnessFromCompare(
  component: InfrastructureComponent,
  value: unknown,
  expectedHeadRevision: string,
): InfrastructureComponentFreshness {
  const expectedHead = expectedHeadRevision.trim().toLowerCase();
  if (!FULL_SHA.test(expectedHead) || !value || typeof value !== "object" || Array.isArray(value)) return { state: "unknown", unknownReason: "comparison_inconclusive" };
  const compare = value as CompareView;
  const sourceHeadRevision = headRevision(compare);
  if (sourceHeadRevision !== expectedHead) return { state: "unknown", unknownReason: "comparison_inconclusive" };
  if (compare.status === "identical") {
    return { state: "current", sourceHeadRevision };
  }
  if (compare.status !== "ahead" || !Array.isArray(compare.files) || compare.files.length > GITHUB_MAX_SAFE_FILES) {
    return { state: "unknown", unknownReason: "comparison_inconclusive" };
  }
  const paths: string[] = [];
  for (const raw of compare.files as CompareFile[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.filename !== "string" || !raw.filename) return { state: "unknown", unknownReason: "comparison_inconclusive" };
    paths.push(raw.filename);
    if (typeof raw.previous_filename === "string" && raw.previous_filename) paths.push(raw.previous_filename);
  }
  if (hasUnclassifiedDeploymentChanges(paths)) return { state: "unknown", unknownReason: "unclassified_changes" };
  const changed = deploymentComponentImpact(paths)[component];
  return {
    state: changed ? "superseded" : "current",
    sourceHeadRevision,
  };
}

export async function resolveComponentFreshness(
  component: InfrastructureComponent,
  deployedRevision: string,
  sourceHeadRevision: string,
  loadComparison: () => Promise<unknown | undefined>,
): Promise<InfrastructureComponentFreshness> {
  if (deployedRevision === sourceHeadRevision) {
    return { state: "current", sourceHeadRevision, latestRelevantRevision: deployedRevision };
  }
  const comparison = await loadComparison();
  if (comparison === undefined) return { state: "unknown", sourceHeadRevision, unknownReason: "comparison_unavailable" };
  const result = resolveComponentFreshnessFromCompare(component, comparison, sourceHeadRevision);
  return result.state === "current" ? { ...result, latestRelevantRevision: deployedRevision } : result;
}
