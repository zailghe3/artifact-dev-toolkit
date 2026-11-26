import { Suspense } from "react";
import { RuntimeDiagnosticProvider } from "@/components/ADTRuntimeExecutionPathDiagnostic";
import { ArtifactValidationProvider } from "@/components/ArtifactValidationAction";
import { ContentLoading } from "@/components/ContentLoading";
import {
  ArtifactLibraryDomain, AuthenticationDomain, ControlPlaneDomain, DiagnosticDomainFrame,
  DiagnosticsOverall, DiagnosticsOverallPanel, RunnerDomain, RuntimeDomain,
} from "@/components/DiagnosticsDomains";
import { DiagnosticsMaintenanceProvider, MaintenanceDuePanel } from "@/components/DiagnosticsMaintenance";
import { DiagnosticsObservations } from "@/components/DiagnosticsObservations";
import { PageHeader } from "@/components/Ui";
import { requireDiagnosticsAccess } from "@/lib/auth";
import { codexRunnerAttemptDigest, parseWorkflowAttemptCoordinates } from "@/lib/codex-runner-correlation";
import { collectEssentialRunnerDiagnostics } from "@/lib/codex-runner-diagnostics";
import { deploymentMetadata } from "@/lib/deployment-metadata";
import { observe, startDiagnosticObservations } from "@/lib/diagnostic-observations";
import { observeRuntimeReadiness } from "@/lib/diagnostic-readiness";
import { diagnosticDomainTitles, type DomainKey } from "@/lib/operational-diagnostics";
import { startRepositoryDiagnostics } from "@/lib/repository-diagnostics";
import { getRuntimeCodexRunnerClient } from "@/lib/workflow-services";

export const dynamic = "force-dynamic";

function PendingDomain({ id }: { id: DomainKey }) {
  return (
    <DiagnosticDomainFrame id={id} state="pending">
      <div className="mt-4"><ContentLoading label={`Checking ${diagnosticDomainTitles[id]}`} rows={2} cards /></div>
    </DiagnosticDomainFrame>
  );
}

export default async function DiagnosticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireDiagnosticsAccess();
  const query = await searchParams;
  const coordinates = parseWorkflowAttemptCoordinates(query);
  const expectedDigest = coordinates ? codexRunnerAttemptDigest(coordinates) : undefined;
  const validationRequested = query.validation === "run";
  const observedAt = new Date().toISOString();
  const repository = startRepositoryDiagnostics(session, { includeValidation: validationRequested });
  const authentication = observe(() => repository.authentication);
  const observations = startDiagnosticObservations({
    repository: () => repository.report,
    runtime: observeRuntimeReadiness,
    runner: () => collectEssentialRunnerDiagnostics({ clientFactory: () => getRuntimeCodexRunnerClient(session.repositoryAuthorization.repositoryId!) }),
  });

  return (
    <DiagnosticsMaintenanceProvider>
      <DiagnosticsObservations key={observedAt}>
        <RuntimeDiagnosticProvider>
          <ArtifactValidationProvider>
        <PageHeader title="Diagnostics & maintenance" description="Check the application, artifact repository, and services that run your workflows." />
        <nav aria-label="Diagnostic domains" className="mb-5 flex flex-wrap gap-2">
          {Object.entries(diagnosticDomainTitles).map(([id, title]) => (
            <a className="adt-button adt-button-secondary" href={`#${id}`} key={id}>{title}</a>
          ))}
          <a className="adt-button adt-button-secondary" href="#maintenance">Maintenance</a>
        </nav>
        <div className="grid gap-4">
          <Suspense fallback={<DiagnosticsOverallPanel pending={3} />}>
            <DiagnosticsOverall observations={observations} deploymentConfigured={!!deploymentMetadata} />
          </Suspense>
          <Suspense fallback={<PendingDomain id="authentication-access" />}>
            <AuthenticationDomain initial={authentication} />
          </Suspense>
          <Suspense fallback={<PendingDomain id="artifact-library" />}>
            <ArtifactLibraryDomain initial={observations.repository} />
          </Suspense>
          <ControlPlaneDomain deployment={deploymentMetadata} observedAt={observedAt} />
          <Suspense fallback={<PendingDomain id="adt-runtime" />}>
            <RuntimeDomain initial={observations.runtime} />
          </Suspense>
          <Suspense fallback={<PendingDomain id="codex-runner" />}>
            <RunnerDomain initial={observations.runner} expectedDigest={expectedDigest} />
          </Suspense>
          <MaintenanceDuePanel />
        </div>
          </ArtifactValidationProvider>
        </RuntimeDiagnosticProvider>
      </DiagnosticsObservations>
    </DiagnosticsMaintenanceProvider>
  );
}
