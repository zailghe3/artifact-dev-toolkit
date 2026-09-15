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
    const latestRelevantRevision = normalizedRevision(resolved.latestRelevantRevision);
    return {
      ...resolved,
      deployedRevision,
      ...(latestRelevantRevision ? { latestRelevantRevision } : {}),
    };
  } catch {
    return { state: "unknown" };
  }
}

function withDeadline(
  value: Promise<InfrastructureComponentFreshness>,
  signal: AbortSignal,
): Promise<InfrastructureComponentFreshness> {
  if (signal.aborted) return Promise.resolve({ state: "unknown" });
  return Promise.race([
    value,
    new Promise<InfrastructureComponentFreshness>((resolve) => signal.addEventListener("abort", () => resolve({ state: "unknown" }), { once: true })),
  ]);
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
    const [worker, runtime, runner] = await Promise.all([
      withDeadline(componentFreshness("worker", workerRevision, dependencies.resolveRevisionFreshness, signal), signal),
      withDeadline(componentFreshness("runtime", runtimeRevision, dependencies.resolveRevisionFreshness, signal), signal),
      withDeadline(componentFreshness("runner", runnerRevision, dependencies.resolveRevisionFreshness, signal), signal),
    ]);
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
