export type InfrastructureComponent = "worker" | "runtime" | "runner";
export type InfrastructureComponentFreshnessState = "current" | "superseded" | "unknown";
export type InfrastructureFreshnessState = InfrastructureComponentFreshnessState;
export const infrastructureFreshnessUnknownReasons = ["revision_unavailable", "source_head_unavailable", "comparison_unavailable", "comparison_timeout", "comparison_inconclusive", "unclassified_changes", "github_rate_limited", "github_access_unavailable"] as const;
export type InfrastructureFreshnessUnknownReason = typeof infrastructureFreshnessUnknownReasons[number];

export type InfrastructureComponentFreshness = {
  state: InfrastructureComponentFreshnessState;
  deployedRevision?: string;
  sourceHeadRevision?: string;
  latestRelevantRevision?: string;
  unknownReason?: InfrastructureFreshnessUnknownReason;
};

export type InfrastructureFreshnessSnapshot = {
  state: InfrastructureFreshnessState;
  checkedAt: string;
  components: Record<InfrastructureComponent, InfrastructureComponentFreshness>;
};

const componentKeys: InfrastructureComponent[] = ["worker", "runtime", "runner"];
const componentStates = new Set<InfrastructureComponentFreshnessState>(["current", "superseded", "unknown"]);
const fullSha = /^[0-9a-f]{40}$/i;
const unknownReasons = new Set<string>(infrastructureFreshnessUnknownReasons);

// Keep the browser budget comfortably above the bounded server collection so
// serialization and transport do not turn a completed observation into a
// client-side timeout.
export const INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS = 3_500;
export const INFRASTRUCTURE_FRESHNESS_CLIENT_TIMEOUT_MS = 5_000;
export const INFRASTRUCTURE_FRESHNESS_CLIENT_TTL_MS = 2 * 60_000;
export const INFRASTRUCTURE_FRESHNESS_UNKNOWN_CLIENT_TTL_MS = 15_000;
export const INFRASTRUCTURE_FRESHNESS_SERVER_CACHE_MS = 60_000;
export const INFRASTRUCTURE_FRESHNESS_UNKNOWN_SERVER_CACHE_MS = 15_000;

export function infrastructureFreshnessHasUnknownComponent(snapshot: InfrastructureFreshnessSnapshot): boolean {
  return componentKeys.some((component) => snapshot.components[component].state === "unknown");
}

export function infrastructureFreshnessClientTtl(snapshot: InfrastructureFreshnessSnapshot): number {
  return infrastructureFreshnessHasUnknownComponent(snapshot)
    ? INFRASTRUCTURE_FRESHNESS_UNKNOWN_CLIENT_TTL_MS
    : INFRASTRUCTURE_FRESHNESS_CLIENT_TTL_MS;
}

export function infrastructureFreshnessServerTtl(snapshot: InfrastructureFreshnessSnapshot): number {
  return infrastructureFreshnessHasUnknownComponent(snapshot)
    ? INFRASTRUCTURE_FRESHNESS_UNKNOWN_SERVER_CACHE_MS
    : INFRASTRUCTURE_FRESHNESS_SERVER_CACHE_MS;
}

export function aggregateInfrastructureFreshness(
  components: InfrastructureFreshnessSnapshot["components"],
): InfrastructureFreshnessState {
  const states = componentKeys.map((key) => components[key].state);
  if (states.includes("superseded")) return "superseded";
  if (states.includes("unknown")) return "unknown";
  return "current";
}

function parseComponent(value: unknown): InfrastructureComponentFreshness | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (!componentStates.has(item.state as InfrastructureComponentFreshnessState)) return undefined;
  if (item.deployedRevision !== undefined && (typeof item.deployedRevision !== "string" || !fullSha.test(item.deployedRevision))) return undefined;
  if (item.sourceHeadRevision !== undefined && (typeof item.sourceHeadRevision !== "string" || !fullSha.test(item.sourceHeadRevision))) return undefined;
  if (item.latestRelevantRevision !== undefined && (typeof item.latestRelevantRevision !== "string" || !fullSha.test(item.latestRelevantRevision))) return undefined;
  if (item.unknownReason !== undefined && (item.state !== "unknown" || typeof item.unknownReason !== "string" || !unknownReasons.has(item.unknownReason))) return undefined;
  if (Object.keys(item).some((key) => !["state", "deployedRevision", "sourceHeadRevision", "latestRelevantRevision", "unknownReason"].includes(key))) return undefined;
  return {
    state: item.state as InfrastructureComponentFreshnessState,
    ...(typeof item.deployedRevision === "string" ? { deployedRevision: item.deployedRevision.toLowerCase() } : {}),
    ...(typeof item.sourceHeadRevision === "string" ? { sourceHeadRevision: item.sourceHeadRevision.toLowerCase() } : {}),
    ...(typeof item.latestRelevantRevision === "string" ? { latestRelevantRevision: item.latestRelevantRevision.toLowerCase() } : {}),
    ...(typeof item.unknownReason === "string" ? { unknownReason: item.unknownReason as InfrastructureFreshnessUnknownReason } : {}),
  };
}

export function parseInfrastructureFreshnessSnapshot(value: unknown): InfrastructureFreshnessSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (!componentStates.has(item.state as InfrastructureFreshnessState) || typeof item.checkedAt !== "string" || !Number.isFinite(Date.parse(item.checkedAt))) return undefined;
  if (!item.components || typeof item.components !== "object" || Array.isArray(item.components)) return undefined;
  if (Object.keys(item).some((key) => !["state", "checkedAt", "components"].includes(key))) return undefined;
  const source = item.components as Record<string, unknown>;
  if (Object.keys(source).some((key) => !componentKeys.includes(key as InfrastructureComponent))) return undefined;
  const worker = parseComponent(source.worker), runtime = parseComponent(source.runtime), runner = parseComponent(source.runner);
  if (!worker || !runtime || !runner) return undefined;
  const components = { worker, runtime, runner };
  if (aggregateInfrastructureFreshness(components) !== item.state) return undefined;
  return { state: item.state as InfrastructureFreshnessState, checkedAt: new Date(item.checkedAt).toISOString(), components };
}

export function infrastructureFreshnessLabel(snapshot: InfrastructureFreshnessSnapshot): string {
  if (snapshot.state === "current") return "Infra current";
  const labels: Record<InfrastructureComponent, string> = { worker: "App", runtime: "Runtime", runner: "Runner" };
  const stale = componentKeys.filter((key) => snapshot.components[key].state === "superseded").map((key) => labels[key]);
  if (stale.length === 1) return `${stale[0]} update available`;
  if (stale.length > 1) return `Updates available · ${stale.join(" + ")}`;
  const unknown = componentKeys.filter((key) => snapshot.components[key].state === "unknown").map((key) => labels[key]);
  return unknown.length === 1 ? `${unknown[0]} freshness unavailable` : `Infrastructure freshness unavailable${unknown.length ? ` · ${unknown.join(" + ")}` : ""}`;
}

function shortRevision(value: string | undefined): string {
  return value?.slice(0, 7) ?? "?";
}

export function infrastructureRevisionLabel(snapshot: InfrastructureFreshnessSnapshot): string {
  return (["runtime", "runner"] as const)
    .flatMap((component) => {
      const revision = snapshot.components[component].deployedRevision;
      const target = snapshot.components[component].state === "superseded" ? snapshot.components[component].latestRelevantRevision : undefined;
      return revision ? [`${component === "runtime" ? "Runtime" : "Runner"} ${shortRevision(revision)}${target ? ` → ${shortRevision(target)}` : ""}`] : [];
    })
    .join(" · ");
}
