"use client";

import { use } from "react";

import { CodexRunnerAdvancedDiagnostics } from "@/components/CodexRunnerAdvancedDiagnostics";
import { CodexRunnerOperationalStatus } from "@/components/CodexRunnerOperationalStatus";
import { DiagnosticCopyActions } from "@/components/DiagnosticCopyActions";
import { ADTRuntimeExecutionPathDiagnostic, useRuntimeDiagnosticDomains } from "@/components/ADTRuntimeExecutionPathDiagnostic";
import { ArtifactValidationAction, ArtifactValidationCopyActions, useArtifactValidationDomains, useArtifactValidationPending } from "@/components/ArtifactValidationAction";
import { ApplicationControlPlaneDiagnostics } from "@/components/ApplicationControlPlaneDiagnostics";
import { CodexRunnerTestDiagnostic } from "@/components/CodexRunnerTestDiagnostic";
import { CatalogueRefreshControls } from "@/components/CatalogueRefresh";
import { DiagnosticStatusBadge } from "@/components/DiagnosticStatusBadge";
import {
  ObservationControls,
  useDiagnosticObservation,
  useRepositoryObservationUpdate,
} from "@/components/DiagnosticsObservations";
import { LocalizedTime } from "@/components/LocalizedTime";
import {
  getDeploymentDisplayModel,
  type DeploymentMetadata,
} from "@/lib/deployment-metadata";
import { catalogueRefreshAvailability } from "@/lib/diagnostics-model";
import {
  authorizationStatusPresentation,
  cacheStatusPresentation,
  configurationStatusPresentation,
  installationStatusPresentation,
  permissionStatusPresentation,
  repositoryMatchPresentation,
  revisionStatusPresentation,
} from "@/lib/diagnostics-presentation";
import type {
  DiagnosticObservations,
  Observation,
} from "@/lib/diagnostic-observations";
import {
  artifactLibraryDiagnosticDomain,
  authenticationDiagnosticDomain,
  controlPlaneDiagnosticDomain,
  diagnosticDomainTitles,
  operationalContributors,
  operationalOverall,
  repositoryDiagnosticDomains,
  runnerDiagnosticDomain,
  runtimeDiagnosticDomain,
  runtimeDiagnosticChecks,
  type DiagnosticCheck,
  type DiagnosticDomain,
  type DomainKey,
  type DomainState,
} from "@/lib/operational-diagnostics";
import { Panel } from "@/components/Ui";
import type { RepositoryAuthenticationDiagnostics } from "@/lib/repository-diagnostics";

const descriptions: Record<DomainKey, string> = {
  "authentication-access":
    "Session, repository authorization, GitHub App installation, and effective permissions.",
  "artifact-library":
    "Repository revision, catalogue cache, and content validation.",
  "application-control-plane":
    "Deployment identity and infrastructure freshness.",
  "adt-runtime": "Readiness for Workflow execution.",
  "codex-runner":
    "Readiness, compatibility, authentication, emergency stop, and enabled environments.",
};

const domainBadges = {
  healthy: { label: "Healthy", tone: "positive" },
  failed: { label: "Needs attention", tone: "negative" },
  degraded: { label: "Degraded", tone: "warning" },
  "not-configured": { label: "Not configured", tone: "neutral" },
  pending: { label: "Checking", tone: "neutral" },
  refreshing: { label: "Refreshing", tone: "neutral" },
} as const;

function Card({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="rounded-lg border border-border p-4">
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-2 space-y-2 text-sm">{children}</div>
    </section>
  );
}

function Check({ check }: { check: DiagnosticCheck }) {
  return (
    <Card id={check.id} title={check.label}>
      <DiagnosticStatusBadge presentation={check.status} />
      {check.value && <p className="mt-2 break-words">{check.value}</p>}
      {check.status.description && (
        <p className="text-muted-foreground">{check.status.description}</p>
      )}
      {check.guidance && <p>{check.guidance}</p>}
    </Card>
  );
}

function Status({
  label,
  presentation,
}: {
  label: string;
  presentation: Parameters<typeof DiagnosticStatusBadge>[0]["presentation"];
}) {
  return (
    <p className="flex flex-wrap items-center gap-2">
      <strong>{label}</strong>
      <DiagnosticStatusBadge presentation={presentation} />
      {presentation.description ? (
        <span className="text-xs text-muted-foreground">
          {presentation.description}
        </span>
      ) : null}
    </p>
  );
}

export function DiagnosticDomainFrame({
  id,
  state,
  children,
}: {
  id: DomainKey;
  state: DomainState | "pending" | "refreshing";
  children: React.ReactNode;
}) {
  return (
    <Panel id={id} aria-labelledby={`${id}-heading`} className="sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={`${id}-heading`}
          className="text-lg font-semibold tracking-tight"
        >
          {diagnosticDomainTitles[id]}
        </h2>
        <DiagnosticStatusBadge presentation={domainBadges[state]} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{descriptions[id]}</p>
      {children}
    </Panel>
  );
}

export function DiagnosticsOverallPanel({
  domains = [],
  pending = 0,
  observedAt,
}: {
  domains?: DiagnosticDomain[];
  pending?: number;
  observedAt?: string;
}) {
  const overall = operationalOverall(domains, pending);
  const { contributors, omittedCount } = operationalContributors(domains);
  return (
    <Panel aria-labelledby="overall-heading" className="sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="overall-heading"
          className="text-lg font-semibold tracking-tight"
        >
          Overall health
        </h2>
        <DiagnosticStatusBadge presentation={overall.status} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {overall.status.description}
      </p>
      {contributors.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Needs attention</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {contributors.map((item) => (
              <li key={item.id}>
                <a className="underline underline-offset-2" href={item.href}>
                  {item.message}
                </a>
              </li>
            ))}
          </ul>
          {omittedCount > 0 && (
            <p className="mt-2 text-sm">
              And {omittedCount} more diagnostic{" "}
              {omittedCount === 1 ? "check" : "checks"}.
            </p>
          )}
        </div>
      )}
      {observedAt && (
        <p className="mt-3 text-xs text-muted-foreground">
          Last updated <LocalizedTime value={observedAt} />
        </p>
      )}
    </Panel>
  );
}

export function DiagnosticsOverall({
  observations,
  deploymentConfigured,
}: {
  observations: DiagnosticObservations;
  deploymentConfigured: boolean;
}) {
  const repository = useDiagnosticObservation(
    "repository",
    observations.repository,
  );
  const runtime = useDiagnosticObservation("runtime", observations.runtime);
  const runner = useDiagnosticObservation("runner", observations.runner);
  const { authentication, artifacts } = repositoryDiagnosticDomains(
    repository.result.value,
  );
  const domains = useRuntimeDiagnosticDomains(useArtifactValidationDomains([
    authentication,
    artifacts,
    controlPlaneDiagnosticDomain(deploymentConfigured),
    runtimeDiagnosticDomain(runtime.result.value ?? undefined),
    runnerDiagnosticDomain(runner.result.value ?? undefined),
  ], repository.result.value?.repositoryRevision.value));
  const validationPending = useArtifactValidationPending();
  const pending = [repository, runtime, runner].filter(item => item.pending).length + Number(validationPending);
  const observedAt = [
    repository.result.observedAt,
    runtime.result.observedAt,
    runner.result.observedAt,
  ]
    .sort()
    .at(-1);
  return (
    <DiagnosticsOverallPanel
      domains={domains}
      pending={pending}
      observedAt={observedAt}
    />
  );
}

export function AuthenticationDomain({
  initial,
}: {
  initial: Promise<Observation<RepositoryAuthenticationDiagnostics>>;
}) {
  const original = use(initial);
  const update = useRepositoryObservationUpdate();
  const result = update?.result ?? original;
  const lastGood = update?.lastGood.value ? update.lastGood : original;
  const repository = lastGood.value;
  const domain = authenticationDiagnosticDomain(repository);
  const state = authenticationDiagnosticDomain(result.value).state;
  return (
    <DiagnosticDomainFrame
      id={domain.key}
      state={update?.pending ? "refreshing" : state}
    >
      <ObservationControls
        state={{
          result,
          lastGood: {
            ...lastGood,
            observedAt: repository?.generatedAt ?? lastGood.observedAt,
          },
          pending: update?.pending,
        }}
      />
      {repository ? (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card title="Repository access" id="authorization">
              <Status
                label="Session"
                presentation={{ label: "Valid", tone: "positive" }}
              />
              <div id="repository-match">
                <Status
                  label="Configured repository"
                  presentation={repositoryMatchPresentation(
                    repository.authorization.repositoryMatches,
                  )}
                />
              </div>
              <Status
                label="Live authorization"
                presentation={authorizationStatusPresentation(
                  repository.authorization.liveState,
                )}
              />
              <Status
                label="GitHub App"
                presentation={installationStatusPresentation(
                  repository.installation.state,
                )}
              />
            </Card>
            <Card title="Effective permissions" id="permissions">
              <Status
                label="Contents read"
                presentation={permissionStatusPresentation(
                  repository.permissions.contentsRead,
                )}
              />
              <div id="permissions-write">
                <Status
                  label="Contents write"
                  presentation={permissionStatusPresentation(
                    repository.permissions.contentsWrite,
                  )}
                />
              </div>
            </Card>
          </div>
          <details className="mt-4 adt-panel">
            <summary className="cursor-pointer font-bold">
              Operational &amp; technical details
            </summary>
            <p className="mt-3">
              <b>GitHub login:</b> @{repository.identity.login} ·{" "}
              <b>GitHub ID:</b> {repository.identity.githubId}
            </p>
            <p>
              <b>Repository ID:</b>{" "}
              {repository.installation.repositoryId ?? "unknown"} ·{" "}
              <b>Installation ID:</b>{" "}
              {repository.installation.installationId ?? "unknown"}
            </p>
            {[
              [
                "GitHub App configuration",
                [
                  "GITHUB_APP_ID",
                  "GITHUB_APP_CLIENT_ID",
                  "GITHUB_APP_CLIENT_SECRET",
                  "GITHUB_APP_PRIVATE_KEY",
                ],
              ],
              ["Session configuration", ["SESSION_SECRET"]],
            ].map(([label, names]) => {
              const states = (names as string[]).map(
                (name) => repository.configuration.authSecrets[name],
              );
              const state = states.includes("invalid")
                ? "invalid"
                : states.includes("missing")
                  ? "missing"
                  : "configured";
              return (
                <Status
                  key={label as string}
                  label={label as string}
                  presentation={configurationStatusPresentation(state)}
                />
              );
            })}
          </details>
          <DiagnosticCopyActions
            report={{
              domain: "authentication-access",
              observedAt: repository.generatedAt,
              state: domain.state,
              repositoryMatch:
                repository.authorization.repositoryMatches === true
                  ? "match"
                  : repository.authorization.repositoryMatches === false
                    ? "mismatch"
                    : "unknown",
              authorization: repository.authorization.liveState,
              installation: repository.installation.state,
              contentsRead:
                repository.permissions.contentsRead.effective === true
                  ? "granted"
                  : repository.permissions.contentsRead.effective === false
                    ? "denied"
                    : "unknown",
              contentsWrite:
                repository.permissions.contentsWrite.effective === true
                  ? "granted"
                  : repository.permissions.contentsWrite.effective === false
                    ? "denied"
                    : "unknown",
            }}
          />
        </>
      ) : (
        <div className="mt-4">
          <Check check={domain.checks[0]} />
        </div>
      )}
    </DiagnosticDomainFrame>
  );
}

export function ArtifactLibraryDomain({
  initial,
}: {
  initial: DiagnosticObservations["repository"];
}) {
  const observation = useDiagnosticObservation("repository", initial);
  const repository = observation.lastGood.value;
  const domain = artifactLibraryDiagnosticDomain(repository);
  const observed = useArtifactValidationDomains(
    [artifactLibraryDiagnosticDomain(observation.result.value)], repository?.repositoryRevision.value,
  )[0];
  const validating = useArtifactValidationPending();
  const artifactRepositoryCheck = domain.checks.find(
    (check) => check.id === "artifact-repository",
  );
  const refreshAvailability = repository
    ? catalogueRefreshAvailability(repository)
    : { available: false as const, reason: "configuration_invalid" as const };
  return (
    <DiagnosticDomainFrame
      id={domain.key}
      state={observation.pending || validating ? "refreshing" : observed.state}
    >
      <ObservationControls
        state={
          repository
            ? {
                ...observation,
                lastGood: {
                  ...observation.lastGood,
                  observedAt: repository.generatedAt,
                },
              }
            : observation
        }
        onRefresh={() => observation.refresh()}
        disabled={validating}
      />
      {repository ? (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card title="Artifact repository" id="artifact-repository">
              <Status
                label="Backend"
                presentation={artifactRepositoryCheck!.status}
              />
              <p>
                <b>Repository:</b> {repository.configuration.owner ?? "—"}/
                {repository.configuration.repository ?? "—"}
              </p>
              <p>
                <b>Branch:</b> {repository.configuration.branch}
              </p>
              <p>
                <b>Artifact root:</b> {repository.configuration.artifactRoot}
              </p>
            </Card>
            <Card title="Repository revision" id="repository-revision">
              <Status
                label="Revision"
                presentation={revisionStatusPresentation(
                  repository.repositoryRevision.state,
                )}
              />
              <p className="font-mono">
                {repository.repositoryRevision.value?.slice(0, 12) ?? "unknown"}
              </p>
            </Card>
            <Card title="Catalogue health" id="catalogue-cache">
              <div id="cache-binding">
                <Status
                  label="Cache binding"
                  presentation={configurationStatusPresentation(
                    repository.configuration.cacheBinding,
                  )}
                />
              </div>
              <Status
                label="Catalogue"
                presentation={cacheStatusPresentation(repository.cache.state)}
              />
              <p>
                Artifacts: {repository.cache.artifactCount ?? "unknown"} · Age:{" "}
                {repository.cache.ageSeconds ?? "unknown"}s
              </p>
              <p>
                Cache revision:{" "}
                <span className="font-mono">
                  {repository.cache.revision?.slice(0, 12) ?? "unknown"}
                </span>
              </p>
              <p>
                Current revision match:{" "}
                {repository.cache.currentRevisionMatches === true
                  ? "Yes"
                  : repository.cache.currentRevisionMatches === false
                    ? "No"
                    : "Unknown"}
              </p>
              <CatalogueRefreshControls availability={refreshAvailability} />
            </Card>
          </div>
          <ArtifactValidationAction initial={repository.validation} revision={repository.repositoryRevision.value} disabled={observation.pending} />
          <ArtifactValidationCopyActions domain={domain}
            report={{
              domain: "artifact-library",
              observedAt: repository.generatedAt,
              state: domain.state,
              repository: `${repository.configuration.owner ?? "local"}/${repository.configuration.repository ?? "artifacts"}`,
              branch: repository.configuration.branch,
              repositoryRevision: repository.repositoryRevision.value,
              catalogue: repository.cache.state,
              cacheRevision: repository.cache.revision,
              artifactCount: repository.cache.artifactCount,
              validation: repository.validation.state,
              validCount: repository.validation.validCount,
              invalidCount: repository.validation.invalidCount,
              validationCodes:
                repository.validation.errors?.map((error) => error.code) ?? [],
              omittedErrorCount: repository.validation.omittedErrorCount,
            }}
          />
        </>
      ) : (
        <div className="mt-4">
          <Check check={domain.checks[0]} />
        </div>
      )}
    </DiagnosticDomainFrame>
  );
}

export function ControlPlaneDomain({
  deployment,
  observedAt,
}: {
  deployment: DeploymentMetadata | null;
  observedAt: string;
}) {
  const domain = controlPlaneDiagnosticDomain(!!deployment);
  const deployed = deployment ? getDeploymentDisplayModel(deployment) : null;
  return (
    <DiagnosticDomainFrame id={domain.key} state={domain.state}>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Check check={domain.checks[0]} />
        {deployed ? (
          <Card title="Deployment metadata">
            <p>
              <b>Revision:</b>{" "}
              <a className="font-mono underline" href={deployed.commitUrl}>
                {deployed.shortCommitSha}
              </a>
            </p>
            <p>
              Deployed <LocalizedTime value={deployed.deployedAt} />
            </p>
            {deployed.pullRequestNumber ? (
              <p>
                <a className="underline" href={deployed.pullRequestUrl}>
                  Pull request #{deployed.pullRequestNumber}
                </a>
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>
      <ApplicationControlPlaneDiagnostics
        observedAt={observedAt}
        deployment={{
          revision: deployment?.commitSha,
          pullRequest: deployment?.pullRequestNumber,
          deployedAt: deployment?.deployedAt,
        }}
      />
    </DiagnosticDomainFrame>
  );
}

export function RuntimeDomain({ initial }: { initial: DiagnosticObservations["runtime"] }) {
  const observation = useDiagnosticObservation("runtime", initial);
  const runtime = observation.lastGood.value;
  const domain = runtimeDiagnosticDomain(runtime ?? undefined);
  const state = useRuntimeDiagnosticDomains([runtimeDiagnosticDomain(observation.result.value ?? undefined)])[0].state;
  const infrastructureReadiness = runtime?.readinessAccepted ? "available"
    : runtime?.httpStatus && runtime.authenticationAccepted === null ? "not_verified" : "unavailable";
  return (
    <DiagnosticDomainFrame id={domain.key} state={observation.pending ? "refreshing" : state}>
      <ObservationControls state={observation} onRefresh={() => observation.refresh()} />
      <div className="mt-4 rounded-lg border border-border p-4">
        <Status label="Infrastructure readiness" presentation={infrastructureReadiness === "available"
          ? { label: "Available", tone: "positive" } : infrastructureReadiness === "unavailable"
            ? { label: "Unavailable", tone: "negative" } : { label: "Not verified", tone: "warning" }} />
      </div>
      {runtime && (
        <details className="mt-4 adt-panel">
          <summary className="cursor-pointer font-semibold">Readiness details</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {runtimeDiagnosticChecks(runtime).map(check => <Check key={check.id} check={check} />)}
          </div>
        </details>
      )}
      <ADTRuntimeExecutionPathDiagnostic domain={domain} report={{
        domain: "adt-runtime", observedAt: observation.lastGood.observedAt, state: domain.state, infrastructureReadiness,
        configured: runtime?.configured ?? false, reachable: runtime?.reachable ?? false,
        authenticationAccepted: runtime?.authenticationAccepted ?? null, protocolCompatible: runtime?.protocolCompatible ?? false,
        openaiAgents: runtime?.capabilityAvailable ?? false, langgraphGraph: runtime?.graphCapabilityAvailable ?? false,
        adrianSecurity: runtime?.adrianSecurityCapabilityAvailable ?? false, adrianSecurityTest: runtime?.adrianSecurityTestCapabilityAvailable ?? false,
        wrappingKeyCompatible: runtime?.wrappingKeyMatches ?? false, elapsedMs: runtime?.elapsedMs ?? 0,
        runtimeRevision: runtime?.runtimeRevision, runtimeFreshness: runtime?.runtimeFreshness ?? "unknown",
        runtimeReleaseRevision: runtime?.runtimeReleaseRevision, expectedRuntimeReleaseRevision: runtime?.expectedRuntimeReleaseRevision,
        httpStatus: runtime?.httpStatus,
      }} />
    </DiagnosticDomainFrame>
  );
}

export function RunnerDomain({
  initial,
  expectedDigest,
}: {
  initial: DiagnosticObservations["runner"];
  expectedDigest?: string;
}) {
  const observation = useDiagnosticObservation("runner", initial);
  const runner = observation.lastGood.value;
  const domain = runnerDiagnosticDomain(runner ?? undefined);
  const state = runnerDiagnosticDomain(
    observation.result.value ?? undefined,
  ).state;
  return (
    <DiagnosticDomainFrame
      id={domain.key}
      state={observation.pending ? "refreshing" : state}
    >
      <ObservationControls
        state={observation}
        onRefresh={() => observation.refresh()}
      />
      {runner ? (
        <>
          <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <Status
              label="Runner operational readiness"
              presentation={
                domain.state === "healthy"
                  ? { label: "Ready", tone: "positive" }
                  : domain.state === "not-configured"
                    ? { label: "Not configured", tone: "neutral" }
                    : { label: "Needs attention", tone: "negative" }
              }
            />
          </div>
          <details className="mt-4 adt-panel" open={domain.state === "failed"}>
            <summary className="cursor-pointer font-bold">
              Observed status details
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {domain.checks
                .filter((check) => check.contributes !== false || check.id === "runner-job-readiness")
                .map((check) => (
                  <Check key={check.id} check={check} />
                ))}
            </div>
          </details>
          <CodexRunnerOperationalStatus
            connection={runner.connection}
            initialControl={
              runner.control.state === "available"
                ? runner.control.value
                : undefined
            }
            expectedDigest={expectedDigest}
          />
          <DiagnosticCopyActions
            report={{
              domain: "codex-runner",
              observedAt: observation.lastGood.observedAt,
              state: domain.state,
              connection: runner.connection.state,
              protocol: runner.connection.compatibility?.protocol ?? "unknown",
              runnerRelease:
                runner.connection.compatibility?.runnerRevision ?? "unknown",
              codexVersion:
                runner.connection.compatibility?.codexVersion ?? "unknown",
              runnerBuild:
                runner.connection.capabilities?.runnerVersion === "development"
                  ? undefined
                  : runner.connection.capabilities?.runnerVersion,
              codexCliReady: runner.connection.capabilities?.codexAvailable ?? "unknown",
              deviceAuthSupported: runner.connection.capabilities?.deviceAuth ?? "unknown",
              jobExecutionSupported: runner.connection.capabilities?.jobExecution ?? "unknown",
              chatGptAuthenticated: runner.authentication.state === "available" ? runner.authentication.value.connected : "unknown",
              emergencyStop:
                runner.control.state === "available"
                  ? runner.control.value.emergencyStopped
                  : "unknown",
              executorHealthy:
                runner.control.state === "available"
                  ? (runner.control.value.executor?.healthy ?? "unknown")
                  : "unknown",
            }}
          />
        </>
      ) : (
        <div className="mt-4">
          <Check check={domain.checks[0]} />
        </div>
      )}
      <CodexRunnerTestDiagnostic />
      <CodexRunnerAdvancedDiagnostics />
    </DiagnosticDomainFrame>
  );
}
