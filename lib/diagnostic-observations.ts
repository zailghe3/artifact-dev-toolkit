import type { ADTRuntimeDiagnostic } from "./adt-runtime-client.ts";
import type { SafeRunnerDiagnostics } from "./codex-runner-diagnostics.ts";
import type { RepositoryDiagnostics } from "./repository-diagnostics.ts";

export type DiagnosticValues = {
  repository: RepositoryDiagnostics;
  runtime: ADTRuntimeDiagnostic;
  runner: SafeRunnerDiagnostics;
};
export type ObservationScope = keyof DiagnosticValues;
export type Observation<T> = { value: T; observedAt: string } | { value: null; observedAt: string };
export type DiagnosticObservations = { [K in ObservationScope]: Promise<Observation<DiagnosticValues[K]>> };

export async function observe<T>(read: () => Promise<T>): Promise<Observation<T>> {
  try {
    return { value: await read(), observedAt: new Date().toISOString() };
  } catch {
    return { value: null, observedAt: new Date().toISOString() };
  }
}

export function startDiagnosticObservations(readers: { [K in ObservationScope]: () => Promise<DiagnosticValues[K]> }): DiagnosticObservations {
  return {
    repository: observe(readers.repository),
    runtime: observe(readers.runtime),
    runner: observe(readers.runner),
  };
}
