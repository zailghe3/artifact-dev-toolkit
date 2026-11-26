"use client";

import { createContext, use, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  refreshRepositoryObservation, refreshRunnerObservation, refreshRuntimeObservation,
} from "@/app/(application)/diagnostics/actions";
import { LocalizedTime } from "@/components/LocalizedTime";
import { buttonStyles } from "@/components/Ui";
import type { DiagnosticValues, Observation, ObservationScope } from "@/lib/diagnostic-observations";

type ObservationUpdate<T> = {
  result: Observation<T>;
  lastGood: Observation<T>;
  pending?: boolean;
};
type Updates = { [K in ObservationScope]?: ObservationUpdate<DiagnosticValues[K]> };
type Refreshers = { [K in ObservationScope]: () => Promise<Observation<DiagnosticValues[K]>> };
const refreshers: Refreshers = {
  repository: refreshRepositoryObservation,
  runtime: refreshRuntimeObservation,
  runner: refreshRunnerObservation,
};

const Context = createContext<{
  updates: Updates;
  refresh: <K extends ObservationScope>(scope: K, previous: ObservationUpdate<DiagnosticValues[K]>) => void;
} | null>(null);

export function DiagnosticsObservations({ children }: { children: React.ReactNode }) {
  const [updates, setUpdates] = useState<Updates>({});
  const inFlight = useRef(new Set<ObservationScope>());
  async function refresh<K extends ObservationScope>(scope: K, previous: ObservationUpdate<DiagnosticValues[K]>) {
    if (inFlight.current.has(scope)) return;
    inFlight.current.add(scope);
    setUpdates(current => ({ ...current, [scope]: { ...previous, pending: true } }));
    let result: Observation<DiagnosticValues[K]>;
    try {
      result = await refreshers[scope]();
    } catch {
      result = { value: null, observedAt: new Date().toISOString() };
    } finally {
      inFlight.current.delete(scope);
    }
    setUpdates(current => ({ ...current, [scope]: { result, lastGood: result.value ? result : previous.lastGood } }));
  }
  return <Context value={{ updates, refresh }}>{children}</Context>;
}

function useObservationContext() {
  const context = use(Context);
  if (!context) throw new Error("Missing diagnostics observations");
  return context;
}

export function useRepositoryObservationUpdate() {
  return useObservationContext().updates.repository;
}

export function useDiagnosticObservation<K extends ObservationScope>(scope: K, initial: Promise<Observation<DiagnosticValues[K]>>) {
  const context = useObservationContext();
  const original = use(initial);
  const update: ObservationUpdate<DiagnosticValues[K]> = context.updates[scope] ?? { result: original, lastGood: original };
  return { ...update, refresh: () => context.refresh(scope, update) };
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
          : stale ? "Refresh failed. Showing a previous observation from "
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
