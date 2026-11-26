"use client";

import { createContext, use, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  refreshRepositoryObservation, refreshRunnerObservation, refreshRuntimeObservation,
} from "@/app/(application)/diagnostics/actions";
import { LocalizedTime } from "@/components/LocalizedTime";
import { buttonStyles } from "@/components/Ui";
import type { RepositoryAuthenticationDiagnostics } from "@/lib/repository-diagnostics";
import type { RunnerControlStatus } from "@/lib/codex-runner-client";
import type { DiagnosticValues, Observation, ObservationScope } from "@/lib/diagnostic-observations";

type ObservationUpdate<T> = {
  result: Observation<T>;
  lastGood: Observation<T>;
  pending?: boolean;
};
type Updates = { [K in ObservationScope]?: ObservationUpdate<DiagnosticValues[K]> };
type Refreshers = { [K in ObservationScope]: () => Promise<Observation<DiagnosticValues[K]>> };
type ControlAction = "emergency-stop" | "resume";
type ConfirmedControl = { value: RunnerControlStatus; observedAt: string };
type ControlEvidence = {
  result: Observation<RunnerControlStatus>;
  lastConfirmed?: ConfirmedControl;
  uncertain: boolean;
};

const unavailable = () => ({ value: null, observedAt: new Date().toISOString() });

function observedRunnerControl(observation: Observation<DiagnosticValues["runner"]>): Observation<RunnerControlStatus> {
  const control = observation.value?.control;
  return { value: control?.state === "available" ? control.value : null, observedAt: observation.observedAt };
}

async function requestRunnerControl(action?: ControlAction): Promise<Observation<RunnerControlStatus>> {
  try {
    const response = await fetch("/api/workflow-connections/codex-runner/control", {
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
      ...(action && { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }),
    });
    if (!response.ok) return unavailable();
    const value = await response.json() as RunnerControlStatus;
    if (typeof value?.emergencyStopped !== "boolean"
      || !["controller", "integrated"].includes(value.role)
      || typeof value.hardRestart?.attempted !== "boolean"
      || typeof value.hardRestart?.succeeded !== "boolean"
      || (value.executor !== null && typeof value.executor?.healthy !== "boolean")) return unavailable();
    // The stop response can carry an executor sample taken before the restart.
    return { value: action === "emergency-stop" ? { ...value, executor: null } : value, observedAt: new Date().toISOString() };
  } catch {
    return unavailable();
  }
}

const Context = createContext<{
  updates: Updates;
  refresh: <K extends ObservationScope>(scope: K, previous: ObservationUpdate<DiagnosticValues[K]>) => void;
  controlEvidence?: ControlEvidence;
  controlAction?: ControlAction;
  queryControl: () => Promise<void>;
  changeControl: (action: ControlAction, initial: Observation<RunnerControlStatus>) => Promise<boolean>;
} | null>(null);

export function DiagnosticsObservations({ children }: { children: React.ReactNode }) {
  const [updates, setUpdates] = useState<Updates>({});
  const inFlight = useRef(new Set<ObservationScope>());
  const [controlEvidence, setControlEvidence] = useState<ControlEvidence>();
  const [controlAction, setControlAction] = useState<ControlAction>();
  const controlRequests = useRef({ issued: 0, applied: 0, mutating: false, evidence: undefined as ControlEvidence | undefined });

  function publishControl(result: Observation<RunnerControlStatus>, uncertain = false) {
    const requests = controlRequests.current;
    const lastConfirmed = result.value ? { value: result.value, observedAt: result.observedAt } : requests.evidence?.lastConfirmed;
    const next = { result, lastConfirmed, uncertain: !result.value && (uncertain || !!requests.evidence?.uncertain) };
    requests.evidence = next;
    setControlEvidence(next);
  }

  function acceptControlRead(request: number, result: Observation<RunnerControlStatus>) {
    const requests = controlRequests.current;
    if (requests.mutating || request <= requests.applied) return;
    requests.applied = request;
    publishControl(result);
  }

  async function queryControl() {
    const request = ++controlRequests.current.issued;
    acceptControlRead(request, await requestRunnerControl());
  }

  async function changeControl(action: ControlAction, initial: Observation<RunnerControlStatus>) {
    const requests = controlRequests.current;
    const current = (requests.evidence?.result ?? initial).value;
    if (requests.mutating || !current || current.emergencyStopped !== (action === "resume")) return false;

    requests.mutating = true;
    setControlAction(action);
    const result = await requestRunnerControl(action);
    // A read begun before the mutation settled cannot establish post-mutation state.
    requests.applied = requests.issued;
    publishControl(result, !result.value);
    requests.mutating = false;
    setControlAction(undefined);
    return Boolean(result.value);
  }

  const refreshers: Refreshers = {
    repository: refreshRepositoryObservation,
    runtime: refreshRuntimeObservation,
    runner: async () => {
      const request = ++controlRequests.current.issued;
      const result = await refreshRunnerObservation().catch(unavailable);
      acceptControlRead(request, observedRunnerControl(result));
      return result;
    },
  };

  async function refresh<K extends ObservationScope>(scope: K, previous: ObservationUpdate<DiagnosticValues[K]>) {
    if (inFlight.current.has(scope)) return;
    inFlight.current.add(scope);
    setUpdates(current => ({ ...current, [scope]: { ...previous, pending: true } }));
    let result: Observation<DiagnosticValues[K]>;
    try {
      result = await refreshers[scope]();
    } catch {
      result = unavailable();
    } finally {
      inFlight.current.delete(scope);
    }
    setUpdates(current => ({ ...current, [scope]: { result, lastGood: result.value ? result : previous.lastGood } }));
  }
  return <Context value={{ updates, refresh, controlEvidence, controlAction, queryControl, changeControl }}>{children}</Context>;
}

function useObservationContext() {
  const context = use(Context);
  if (!context) throw new Error("Missing diagnostics observations");
  return context;
}

export function useAuthenticationObservation(initial: Promise<Observation<RepositoryAuthenticationDiagnostics>>) {
  const original = use(initial);
  const update = useObservationContext().updates.repository;
  return { result: update?.result ?? original, lastGood: update?.lastGood.value ? update.lastGood : original, pending: update?.pending };
}

export function useRunnerControl(original: Observation<DiagnosticValues["runner"]>) {
  const { controlEvidence, controlAction, queryControl, changeControl } = useObservationContext();
  const initial = observedRunnerControl(original);
  const result = controlEvidence?.result ?? initial;
  return {
    current: controlAction ? null : result.value,
    observedAt: result.observedAt,
    lastConfirmed: controlEvidence?.lastConfirmed ?? (initial.value ? { value: initial.value, observedAt: initial.observedAt } : undefined),
    action: controlAction,
    uncertain: controlEvidence?.uncertain ?? false,
    query: queryControl,
    change: (action: ControlAction) => changeControl(action, initial),
  };
}

export function useDiagnosticObservation<K extends ObservationScope>(scope: K, initial: Promise<Observation<DiagnosticValues[K]>>) {
  const context = useObservationContext();
  const original = use(initial);
  const update: ObservationUpdate<DiagnosticValues[K]> = context.updates[scope] ?? { result: original, lastGood: original };
  return { ...update, original, refresh: () => context.refresh(scope, update) };
}

export function ObservationControls({ state, onRefresh, disabled }: {
  state: ObservationUpdate<unknown>;
  onRefresh?: () => void;
  disabled?: boolean;
}) {
  const stale = !state.result.value && state.lastGood.value;
  const time = state.lastGood.value ? state.lastGood.observedAt : state.result.observedAt;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <p role={state.result.value ? "status" : "alert"}>
        {state.pending ? "Refreshing… "
          : stale ? "Refresh failed. Last available observation was at "
          : state.result.value ? "Observed " : "Observation unavailable as of "}
        <LocalizedTime value={time} />
      </p>
      {onRefresh && (
        <button type="button" className={buttonStyles.subtle} disabled={state.pending || disabled} onClick={onRefresh}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {state.result.value ? "Refresh observation" : "Retry observation"}
        </button>
      )}
    </div>
  );
}
