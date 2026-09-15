import {
  aggregateInfrastructureFreshness,
  type InfrastructureComponent,
  type InfrastructureComponentFreshness,
  type InfrastructureFreshnessSnapshot,
} from "./infrastructure-freshness.ts";

export type InfrastructureRevisionProbe = (signal: AbortSignal) => Promise<string | undefined>;
export type InfrastructureRevisionFreshnessResolver = (
  component: InfrastructureComponent,
  deployedRevision: string,
  signal: AbortSignal,
) => Promise<InfrastructureComponentFreshness>;

export type InfrastructureFreshnessDependencies = {
  workerRevision?: string;
  runtimeRevision: InfrastructureRevisionProbe;
  runnerRevision: InfrastructureRevisionProbe;
  resolveRevisionFreshness: InfrastructureRevisionFreshnessResolver;
  now?: () => Date;
  timeoutMs?: number;
};

const FULL_SHA = /^[0-9a-f]{40}$/i;

function normalizedRevision(value: string | undefined): string | undefined {
  const revision = value?.trim();
  return revision && FULL_SHA.test(revision) ? revision.toLowerCase() : undefined;
}

async function componentFreshness(
  component: InfrastructureComponent,
  revisionPromise: Promise<string | undefined>,
  resolveRevisionFreshness: InfrastructureRevisionFreshnessResolver,
  signal: AbortSignal,
): Promise<InfrastructureComponentFreshness> {
  try {
    const deployedRevision = normalizedRevision(await revisionPromise);
    if (!deployedRevision || signal.aborted) return { state: "unknown" };
    const resolved = await resolveRevisionFreshness(component, deployedRevision, signal);
    if (signal.aborted) return { state: "unknown", deployedRevision };
    return {
      ...resolved,
      deployedRevision,
      ...(resolved.latestRelevantRevision ? { latestRelevantRevision: normalizedRevision(resolved.latestRelevantRevision) } : {}),
    };
  } catch {
    return { state: "unknown" };
  }
}

export async function collectInfrastructureFreshness(
  dependencies: InfrastructureFreshnessDependencies,
): Promise<InfrastructureFreshnessSnapshot> {
  const controller = new AbortController();
  const timeoutMs = Math.max(250, Math.min(dependencies.timeoutMs ?? 1_500, 5_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  try {
    const workerRevision = Promise.resolve(normalizedRevision(dependencies.workerRevision));
    const runtimeRevision = dependencies.runtimeRevision(signal);
    const runnerRevision = dependencies.runnerRevision(signal);
    const componentPromises = {
      worker: componentFreshness("worker", workerRevision, dependencies.resolveRevisionFreshness, signal),
      runtime: componentFreshness("runtime", runtimeRevision, dependencies.resolveRevisionFreshness, signal),
      runner: componentFreshness("runner", runnerRevision, dependencies.resolveRevisionFreshness, signal),
    };
    const deadline = new Promise<"deadline">((resolve) => signal.addEventListener("abort", () => resolve("deadline"), { once: true }));
    const values = await Promise.race([
      Promise.all([componentPromises.worker, componentPromises.runtime, componentPromises.runner]),
      deadline,
    ]);
    const [worker, runtime, runner] = values === "deadline"
      ? [{ state: "unknown" } as InfrastructureComponentFreshness, { state: "unknown" } as InfrastructureComponentFreshness, { state: "unknown" } as InfrastructureComponentFreshness]
      : values;
    const components = { worker, runtime, runner };
    return {
      state: aggregateInfrastructureFreshness(components),
      checkedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      components,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
