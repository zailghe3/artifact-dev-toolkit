import {
  deploymentComponentImpact,
  hasUnclassifiedDeploymentChanges,
} from "./deployment-component-impact.js";
import type { InfrastructureComponent, InfrastructureComponentFreshness } from "./infrastructure-freshness.ts";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const GITHUB_MAX_SAFE_FILES = 299;

type CompareFile = { filename?: unknown; previous_filename?: unknown };
type CompareView = { status?: unknown; files?: unknown; head_commit?: unknown };

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
  if (!FULL_SHA.test(expectedHead) || !value || typeof value !== "object" || Array.isArray(value)) return { state: "unknown" };
  const compare = value as CompareView;
  const sourceHeadRevision = headRevision(compare);
  if (sourceHeadRevision !== expectedHead) return { state: "unknown" };
  if (compare.status === "identical") {
    return { state: "current", sourceHeadRevision };
  }
  if (compare.status !== "ahead" || !Array.isArray(compare.files) || compare.files.length > GITHUB_MAX_SAFE_FILES) {
    return { state: "unknown" };
  }
  const paths: string[] = [];
  for (const raw of compare.files as CompareFile[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.filename !== "string" || !raw.filename) return { state: "unknown" };
    paths.push(raw.filename);
    if (typeof raw.previous_filename === "string" && raw.previous_filename) paths.push(raw.previous_filename);
  }
  if (hasUnclassifiedDeploymentChanges(paths)) return { state: "unknown" };
  const changed = deploymentComponentImpact(paths)[component];
  return {
    state: changed ? "superseded" : "current",
    sourceHeadRevision,
  };
}
