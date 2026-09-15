export type InfrastructureComponent = "worker" | "runtime" | "runner";
export type InfrastructureComponentFreshnessState = "current" | "superseded" | "unknown";
export type InfrastructureFreshnessState = InfrastructureComponentFreshnessState;

export type InfrastructureComponentFreshness = {
  state: InfrastructureComponentFreshnessState;
  deployedRevision?: string;
  latestRelevantRevision?: string;
};

export type InfrastructureFreshnessSnapshot = {
  state: InfrastructureFreshnessState;
  checkedAt: string;
  components: Record<InfrastructureComponent, InfrastructureComponentFreshness>;
};

const componentKeys: InfrastructureComponent[] = ["worker", "runtime", "runner"];
const componentStates = new Set<InfrastructureComponentFreshnessState>(["current", "superseded", "unknown"]);
const fullSha = /^[0-9a-f]{40}$/i;

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
  if (item.latestRelevantRevision !== undefined && (typeof item.latestRelevantRevision !== "string" || !fullSha.test(item.latestRelevantRevision))) return undefined;
  if (Object.keys(item).some((key) => !["state", "deployedRevision", "latestRelevantRevision"].includes(key))) return undefined;
  return {
    state: item.state as InfrastructureComponentFreshnessState,
    ...(typeof item.deployedRevision === "string" ? { deployedRevision: item.deployedRevision.toLowerCase() } : {}),
    ...(typeof item.latestRelevantRevision === "string" ? { latestRelevantRevision: item.latestRelevantRevision.toLowerCase() } : {}),
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
  if (snapshot.state === "unknown") return "Infra freshness unavailable";
  const labels: Record<InfrastructureComponent, string> = { worker: "Worker", runtime: "Runtime", runner: "Runner" };
  const stale = componentKeys.filter((key) => snapshot.components[key].state === "superseded").map((key) => labels[key]);
  return `Update pending${stale.length ? ` · ${stale.join(" + ")}` : ""}`;
}
