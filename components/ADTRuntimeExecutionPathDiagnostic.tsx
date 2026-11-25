"use client";

import { createContext, useContext, useState } from "react";
import { runtimeManagementDiagnosticSchema, type RuntimeManagementDiagnostic } from "@/adt-runtime/src/runtime-control-contract";
import type { SafeDiagnosticReportInput } from "@/lib/diagnostic-reports";
import { runtimeManagementChecks, withRuntimeManagement, type DiagnosticDomain } from "@/lib/operational-diagnostics";
import { DiagnosticCopyActions } from "./DiagnosticCopyActions";
import { DiagnosticStatusBadge } from "./DiagnosticStatusBadge";
import { PendingButtonContent } from "./PendingButtonContent";
import { buttonStyles } from "./Ui";

type Observation = { diagnostic: RuntimeManagementDiagnostic; observedAt: string };
const RuntimeDiagnosticContext = createContext<{
  observation?: Observation;
  setObservation: (value?: Observation) => void;
} | null>(null);

export function RuntimeDiagnosticProvider({ children }: { children: React.ReactNode }) {
  const [observation, setObservation] = useState<Observation>();
  return <RuntimeDiagnosticContext.Provider value={{ observation, setObservation }}>{children}</RuntimeDiagnosticContext.Provider>;
}

export function useRuntimeDiagnosticDomains(domains: DiagnosticDomain[]) {
  const context = useContext(RuntimeDiagnosticContext);
  return context?.observation ? withRuntimeManagement(domains, context.observation.diagnostic) : domains;
}

const results: Record<RuntimeManagementDiagnostic["management"]["result"], string> = {
  ok: "Management request completed",
  not_configured: "Runtime management transport not configured",
  unreachable: "Management transport unreachable",
  malformed_response: "Management response malformed",
  authentication_failed: "Management authentication rejected",
  protocol_incompatible: "Management protocol incompatible",
  request_rejected: "Management request rejected",
  management_unavailable: "Runtime management unavailable",
  nonce_persistence_unavailable: "PostgreSQL replay-nonce persistence unavailable",
  storage_query_unavailable: "Workflow storage query unavailable",
  storage_data_invalid: "Workflow storage data could not be read",
  operation_rejected: "Management operation rejected",
};
const labels = {
  postgres: "PostgreSQL operational query",
  checkpoints: "PostgreSQL checkpoint read",
  workflow: "Repository-scoped Workflow history read",
  broker: "GitHub credential broker (optional)",
};
const dependencyLabels = { available: "Available", unavailable: "Unavailable", not_verified: "Not verified" };
const outcome = (value: boolean | null) => value === null ? "Not verified" : value ? "Yes" : "No";

export function ADTRuntimeExecutionPathDiagnostic({ domain, report }: {
  domain: DiagnosticDomain;
  report: Extract<SafeDiagnosticReportInput, { domain: "adt-runtime" }>;
}) {
  const context = useContext(RuntimeDiagnosticContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { observation } = context ?? {};
  const diagnostic = observation?.diagnostic;
  const management = diagnostic?.management;
  const checks = runtimeManagementChecks(diagnostic);
  const observed = useRuntimeDiagnosticDomains([domain])[0];
  async function run() {
    if (busy || !context) return;
    setBusy(true);
    setError("");
    context.setObservation(undefined);
    try {
      const response = await fetch("/api/workflow-connections/adt-runtime/execution-path", {
        method: "POST", signal: AbortSignal.timeout(40_000), headers: { "content-type": "application/json" }, body: "{}",
      });
      if (!response.ok) throw new Error();
      const diagnostic = runtimeManagementDiagnosticSchema.parse(await response.json());
      context.setObservation({ diagnostic, observedAt: new Date().toISOString() });
    } catch {
      setError("The execution path diagnostic could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  return <section className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
    <div className="grid gap-2 text-sm">
      {checks.map(check => <div id={check.id} key={check.id} className="flex flex-wrap items-center gap-2">
        <b>{check.label}</b><DiagnosticStatusBadge presentation={check.status} />
      </div>)}
    </div>
    <p className="mt-3 text-sm">The active check reads Workflow storage and requests a repository read credential. It starts no Workflow or provider work.</p>
    <button type="button" disabled={busy} aria-busy={busy} onClick={run} className={`${buttonStyles.secondary} mt-3`}>
      <PendingButtonContent pending={busy}>{busy ? "Testing execution path…" : "Test execution path"}</PendingButtonContent>
    </button>
    {error && <p role="alert" className="mt-3">{error}</p>}
    {diagnostic && management && <div className="mt-4 text-sm" aria-live="polite">
      <p className="font-bold">{results[management.result]} · {management.elapsedMs} ms</p>
      {diagnostic.dependencies.broker.status === "unavailable" && <p>GitHub credential broker unavailable.</p>}
      <details className="mt-3 adt-panel">
        <summary className="cursor-pointer font-bold">Management request details</summary>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>Correlation ID</dt><dd className="break-all font-mono">{management.requestId}</dd>
          <dt>Stage</dt><dd>{management.stage}</dd>
          <dt>HTTP response</dt><dd>{management.httpStatus ?? "Not verified"}</dd>
          <dt>Management endpoint</dt><dd>{management.accepted !== null ? "Reached" :
            management.result === "unreachable" ? "Unreachable" : "Not verified"}</dd>
          <dt>Authenticated</dt><dd>{outcome(management.authenticated)}</dd>
          <dt>Protocol compatible</dt><dd>{outcome(management.protocolCompatible)}</dd>
          <dt>Replay nonce persisted</dt><dd>{outcome(management.noncePersisted)}</dd>
          <dt>Command accepted</dt><dd>{outcome(management.accepted)}</dd>
          <dt>Command dispatched</dt><dd>{outcome(management.dispatched)}</dd>
          {(Object.keys(labels) as Array<keyof typeof labels>).map(key => {
            const check = diagnostic.dependencies[key];
            return <div key={key} className="contents"><dt>{labels[key]}</dt><dd>{dependencyLabels[check.status]}
              {check.elapsedMs !== undefined ? ` · ${check.elapsedMs} ms` : ""}
              {check.result === "storage_data_invalid" ? " · Stored data could not be read" : check.result ? " · Query unavailable" : ""}</dd></div>;
          })}
        </dl>
      </details>
    </div>}
    <DiagnosticCopyActions report={{
      ...report, state: observed.state,
      managementReadiness: checks[0].status.tone === "positive" ? "available" : checks[0].status.tone === "negative" ? "unavailable" : "not_verified",
      workflowStorageReadiness: checks[1].status.tone === "positive" ? "available" : checks[1].status.tone === "negative" ? "unavailable" : "not_verified",
      ...(observation ? { managementDiagnostic: observation.diagnostic, managementObservedAt: observation.observedAt } : {}),
    }} />
  </section>;
}
