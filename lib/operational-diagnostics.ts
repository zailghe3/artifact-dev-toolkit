import type { ADTRuntimeDiagnostic } from "./adt-runtime-client.ts";
import type { SafeRunnerDiagnostics } from "./codex-runner-diagnostics.ts";
import { authorizationStatusPresentation, configurationStatusPresentation, installationStatusPresentation, permissionStatusPresentation, repositoryMatchPresentation, revisionStatusPresentation, cacheStatusPresentation, validationStatusPresentation, type DiagnosticStatusPresentation } from "./diagnostics-presentation.ts";
import type { RepositoryDiagnostics } from "./repository-diagnostics.ts";

export type DomainKey = "authentication-access" | "artifact-library" | "application-control-plane" | "adt-runtime" | "codex-runner";
export type DomainState = "healthy" | "degraded" | "failed" | "not-configured";
export type DiagnosticCheck = { id: string; label: string; status: DiagnosticStatusPresentation; value?: string; guidance?: string };
export type DiagnosticDomain = { key: DomainKey; title: string; state: DomainState; checks: DiagnosticCheck[] };
export type OperationalContributor = { id: string; message: string; href: string };

const status = (label: string, tone: DiagnosticStatusPresentation["tone"], description?: string): DiagnosticStatusPresentation => ({ label, tone, ...(description ? { description } : {}) });
const checkState = (checks: DiagnosticCheck[]): DomainState => checks.some(check => check.status.tone === "negative") ? "failed" : checks.some(check => check.status.tone === "warning" || check.status.tone === "neutral") ? "degraded" : "healthy";
const groupedConfiguration = (d: RepositoryDiagnostics, names: string[]) => {
  const states = names.map(name => d.configuration.authSecrets[name]);
  return configurationStatusPresentation(states.includes("invalid") ? "invalid" : states.includes("missing") ? "missing" : "configured");
};

export function authenticationDiagnosticChecks(d: RepositoryDiagnostics): DiagnosticCheck[] {
  return [
    { id: "session", label: "Signed-in session", status: status("Valid", "positive"), value: `@${d.identity.login} · GitHub ID ${d.identity.githubId}` },
    { id: "repository-match", label: "Configured/stored repository", status: repositoryMatchPresentation(d.authorization.repositoryMatches) },
    { id: "authorization", label: "Live repository authorisation", status: authorizationStatusPresentation(d.authorization.liveState) },
    { id: "installation", label: "GitHub App installation", status: installationStatusPresentation(d.installation.state) },
    { id: "permissions", label: "Contents read", status: permissionStatusPresentation(d.permissions.contentsRead) },
    { id: "permissions-write", label: "Contents write", status: permissionStatusPresentation(d.permissions.contentsWrite) },
    { id: "github-app-configuration", label: "GitHub App configuration", status: groupedConfiguration(d, ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY"]) },
    { id: "session-configuration", label: "Session configuration", status: groupedConfiguration(d, ["SESSION_SECRET"]) },
    { id: "token-encryption-configuration", label: "Token-encryption configuration", status: groupedConfiguration(d, ["GITHUB_TOKEN_ENCRYPTION_KEY"]) },
  ];
}

export function artifactLibraryDiagnosticChecks(d: RepositoryDiagnostics): DiagnosticCheck[] {
  return [
    { id: "artifact-repository", label: "Artifact repository", status: d.configuration.backend === "invalid" || (d.configuration.backend === "github" && (!d.configuration.owner || !d.configuration.repository)) ? status("Invalid", "negative") : status("Configured", "positive") },
    { id: "repository-revision", label: "Repository revision", status: revisionStatusPresentation(d.repositoryRevision.state), value: d.repositoryRevision.value?.slice(0, 12) },
    { id: "cache-binding", label: "Cache binding", status: configurationStatusPresentation(d.configuration.cacheBinding) },
    { id: "catalogue-cache", label: "Catalogue/cache", status: cacheStatusPresentation(d.cache.state) },
    { id: "artifact-validation", label: "Content validation", status: validationStatusPresentation(d.validation.state) },
  ];
}

export function runtimeDiagnosticChecks(runtime: ADTRuntimeDiagnostic): DiagnosticCheck[] {
  if (!runtime.configured) return [{ id: "runtime-configuration", label: "Configuration", status: status("Missing", "negative", "Workflow execution requires the independently deployed ADT Runtime.") }];
  const unknown = (id: string, label: string): DiagnosticCheck => ({ id, label, status: status("Not verified", "warning", "A prerequisite check did not complete successfully.") });
  const checks: DiagnosticCheck[] = [{ id: "runtime-configuration", label: "Configuration", status: status("Configured", "positive") }];
  checks.push({ id: "runtime-reachability", label: "Reachability", status: runtime.reachable ? status("Available", "positive") : status("Unavailable", "negative", "The Runtime readiness endpoint could not be reached."), ...(runtime.httpStatus ? { value: `HTTP ${runtime.httpStatus}` } : {}) });
  if (!runtime.reachable) return [...checks, unknown("runtime-authentication", "Request authentication"), unknown("runtime-protocol", "Protocol compatibility"), unknown("runtime-capability", "openai-agents capability"), unknown("runtime-graph-capability", "langgraph:graph capability"), unknown("runtime-wrapping-key", "Wrapping-key compatibility")];
  checks.push({ id: "runtime-authentication", label: "Request authentication", status: runtime.authenticationAccepted ? status("Accepted", "positive") : status("Rejected", "negative", "Verify the independently configured application-to-Runtime authentication boundary.") });
  if (!runtime.authenticationAccepted) return [...checks, unknown("runtime-protocol", "Protocol compatibility"), unknown("runtime-capability", "openai-agents capability"), unknown("runtime-graph-capability", "langgraph:graph capability"), unknown("runtime-wrapping-key", "Wrapping-key compatibility")];
  checks.push({ id: "runtime-protocol", label: "Protocol compatibility", status: runtime.protocolCompatible ? status("Compatible", "positive") : status("Incompatible", "negative", "Deploy a Runtime version compatible with this application.") });
  if (!runtime.protocolCompatible) return [...checks, unknown("runtime-capability", "openai-agents capability"), unknown("runtime-graph-capability", "langgraph:graph capability"), unknown("runtime-wrapping-key", "Wrapping-key compatibility")];
  checks.push({ id: "runtime-capability", label: "openai-agents capability", status: runtime.capabilityAvailable ? status("Available", "positive") : status("Unavailable", "negative", "The deployed Runtime does not advertise openai-agents.") });
  checks.push({ id: "runtime-graph-capability", label: "langgraph:graph capability", status: runtime.graphCapabilityAvailable ? status("Available", "positive") : status("Unavailable", "negative", "Current Workflow execution requires the generic graph capability.") });
  checks.push({ id: "runtime-wrapping-key", label: "Wrapping-key compatibility", status: runtime.wrappingKeyMatches ? status("Compatible", "positive") : status("Mismatch", "negative", "The application and Runtime wrapping-key configuration do not match.") });
  if (runtime.runtimeRevision) checks.push({ id: "runtime-revision", label: "Runtime revision", status: status("Observed", "positive"), value: runtime.runtimeRevision.slice(0, 12) });
  checks.push({ id: "runtime-elapsed", label: "Readiness elapsed time", status: status("Observed", "positive"), value: `${runtime.elapsedMs} ms` });
  return checks;
}

export function runnerDiagnosticChecks(runner: SafeRunnerDiagnostics): DiagnosticCheck[] {
  const connection = runner.connection;
  if (connection.state === "configuration-missing") return [{ id: "runner-configuration", label: "Configuration", status: status("Not configured", "neutral", "Codex Runner is an optional execution provider until configured.") }];
  if (connection.state === "unavailable") return [{ id: "runner-configuration", label: "Configuration", status: status("Configured", "positive") }, { id: "runner-reachability", label: "Reachability", status: status("Unavailable", "negative", "Open the detailed Runner status for bounded operational diagnostics.") }];
  if (connection.state === "update-required") return [{ id: "runner-reachability", label: "Reachability", status: status("Available", "positive") }, { id: "runner-protocol", label: "Protocol compatibility", status: status("Update required", "negative", "Deploy the expected Runner release before execution.") }];
  const capabilities = connection.capabilities, compatibility = connection.compatibility;
  const checks: DiagnosticCheck[] = [
    { id: "runner-reachability", label: "Reachability", status: status("Available", "positive") },
    { id: "runner-protocol", label: "Protocol compatibility", status: compatibility?.protocol === "compatible" ? status("Compatible", "positive") : status(compatibility?.protocol === "incompatible" ? "Incompatible" : "Unknown", compatibility?.protocol === "incompatible" ? "negative" : "warning") },
    { id: "runner-revision", label: "Runner revision", status: compatibility?.runnerRevision === "current" ? status("Current", "positive") : status(compatibility?.runnerRevision === "unknown" ? "Unknown" : "Update required", compatibility?.runnerRevision === "unknown" ? "warning" : "negative"), ...(capabilities?.releaseMetadata === "current" ? { value: String(capabilities.runnerRevision) } : {}) },
    { id: "runner-codex-cli", label: "Codex CLI", status: !capabilities?.codexAvailable ? status("Unavailable", "negative") : compatibility?.codexVersion === "current" ? status("Compatible", "positive") : status(compatibility?.codexVersion === "mismatch" ? "Version mismatch" : "Unknown", compatibility?.codexVersion === "mismatch" ? "negative" : "warning"), ...(capabilities?.releaseMetadata === "current" ? { value: capabilities.codexVersion } : {}) },
    { id: "runner-device-auth", label: "Device authentication", status: capabilities?.deviceAuth ? status("Available", "positive") : status("Unavailable", "negative") },
    { id: "runner-job-execution", label: "Job execution", status: capabilities?.jobExecution ? status("Available", "positive") : status("Unavailable", "negative") },
    { id: "runner-authentication", label: "Codex authentication", status: connection.state === "connected" ? status("Connected", "positive") : status("Disconnected", "warning", "Connect the Runner to ChatGPT from the existing connection interface.") },
  ];
  if (runner.control.state === "unavailable") checks.push({ id: "runner-control", label: "Execution boundary", status: status("Unknown", "warning") });
  else {
    const control = runner.control.value;
    checks.push({ id: "runner-emergency-stop", label: "Emergency-stop latch", status: control.emergencyStopped ? status("Active", "negative") : status("Clear", "positive") });
    checks.push({ id: "runner-boundary", label: "Execution boundary", status: status(control.role === "controller" ? "Split" : "Integrated", "positive") });
    if (control.executor) checks.push({ id: "runner-executor", label: "Executor health", status: control.executor.healthy ? status("Healthy", "positive") : status("Unhealthy", "negative"), value: control.executor.activity ? `${control.executor.activity.category} activity · ${control.executor.activity.count}` : "No active execution" });
    if (control.hardRestart.attempted) checks.push({ id: "runner-hard-restart", label: "Last hard restart", status: control.hardRestart.succeeded ? status("Succeeded", "positive") : status("Failed", "negative") });
  }
  if (runner.environments.state === "unavailable") checks.push({ id: "runner-environments", label: "Environment readiness", status: status("Unknown", "warning") });
  else for (const item of runner.environments.value.filter(item => item.environment.enabled)) {
    const prefix = `runner-environment-${item.environment.key}`;
    checks.push({ id: prefix, label: item.environment.name, status: item.environment.ready ? status("Ready", "positive") : status("Unavailable", "negative"), value: item.environment.key });
    checks.push({ id: `${prefix}-workspace`, label: `${item.environment.name} workspace`, status: item.workspace.state === "unavailable" ? status("Unavailable", "negative") : item.workspace.value.filesystemReady ? status("Ready", "positive") : status("Unavailable", "negative"), ...(item.workspace.state === "available" && item.workspace.value.headCommit ? { value: `${item.workspace.value.headCommit.slice(0, 12)} · ${item.workspace.value.dirty === true ? "Modified" : item.workspace.value.dirty === false ? "Clean" : "State unknown"}` } : {}) });
    checks.push({ id: `${prefix}-sandbox`, label: `${item.environment.name} sandbox`, status: item.sandbox.state === "unavailable" ? status("Unknown", "warning") : item.sandbox.value === null ? status("Unsupported", "warning") : item.sandbox.value.status === "available" ? status("Available", "positive") : item.sandbox.value.status === "unavailable" ? status("Unavailable", "negative", `Safe reason: ${item.sandbox.value.reason}.`) : status("Unknown", "warning"), ...(item.sandbox.state === "available" && item.sandbox.value ? { value: item.sandbox.value.backend } : {}) });
  }
  if (runner.jobs.state === "unavailable") checks.push({ id: "runner-operations", label: "Current operations", status: status("Unknown", "warning", "The latest job observation failed; idle cannot be inferred.") });
  else {
    const activeId = runner.jobs.value.capacity.activeJobId, active = activeId ? runner.jobs.value.jobs.find(job => job.jobId === activeId) : undefined;
    checks.push({ id: "runner-operations", label: "Current operations", status: status(active ? "Active" : "Idle", "positive"), value: active ? `${active.state} · ${active.environmentKey}` : `${runner.jobs.value.jobs.length} recent job(s)` });
  }
  if (runner.authEnvironment.state === "unavailable") checks.push({ id: "runner-auth-environment", label: "Auth environment", status: status("Unknown", "warning") });
  else {
    const auth = runner.authEnvironment.value;
    const ready = auth.codexAppServerReady && auth.codexVersionMatchesExpected && auth.systemCaBundlePresent && auth.systemCaBundleReadable && auth.systemCaBundleNonEmpty && auth.codexHomeReadable && auth.codexHomeWritable && auth.dnsResolution === "ok";
    checks.push({ id: "runner-auth-environment", label: "Auth environment", status: ready ? status("Ready", "positive") : status("Needs attention", "negative"), value: `App Server ${auth.codexAppServerReady ? "ready" : "unavailable"} · CA ${auth.systemCaBundleReadable && auth.systemCaBundleNonEmpty ? "ready" : "unavailable"} · Codex home ${auth.codexHomeReadable && auth.codexHomeWritable ? "ready" : "unavailable"}` });
  }
  return checks;
}

export function deriveOperationalDomains(repository: RepositoryDiagnostics | null, runtime: ADTRuntimeDiagnostic, runner: SafeRunnerDiagnostics, deploymentConfigured: boolean): DiagnosticDomain[] {
  const unavailable = (id: string, label: string): DiagnosticCheck => ({ id, label, status: status("Unavailable", "negative", "This domain could not be evaluated safely.") });
  const authChecks = repository ? authenticationDiagnosticChecks(repository) : [unavailable("authentication-diagnostics", "Authentication diagnostics")];
  const artifactChecks = repository ? artifactLibraryDiagnosticChecks(repository) : [unavailable("artifact-library-diagnostics", "Artifact Library diagnostics")];
  const runtimeChecks = runtimeDiagnosticChecks(runtime), runnerChecks = runnerDiagnosticChecks(runner);
  return [
    { key: "authentication-access", title: "Authentication & access", state: checkState(authChecks), checks: authChecks },
    { key: "artifact-library", title: "Artifact Library", state: checkState(artifactChecks), checks: artifactChecks },
    { key: "application-control-plane", title: "Application / control plane", state: "healthy", checks: [{ id: "deployment-identity", label: "Deployment identity", status: deploymentConfigured ? status("Available", "positive") : status("Development build", "neutral") }] },
    { key: "adt-runtime", title: "ADT Runtime", state: checkState(runtimeChecks), checks: runtimeChecks },
    { key: "codex-runner", title: "Codex Runner", state: runner.connection.state === "configuration-missing" ? "not-configured" : checkState(runnerChecks), checks: runnerChecks },
  ];
}

export function operationalOverall(domains: DiagnosticDomain[]) {
  const applicable = domains.filter(domain => domain.state !== "not-configured");
  const state: DomainState = applicable.some(domain => domain.state === "failed") ? "failed" : applicable.some(domain => domain.state === "degraded") ? "degraded" : "healthy";
  return { state, status: state === "healthy" ? status("Healthy", "positive", "All applicable operational domains are healthy.") : state === "degraded" ? status("Degraded", "warning", "One or more applicable domains require attention or could not be verified.") : status("Needs attention", "negative", "One or more applicable operational domains are unavailable or unhealthy.") };
}

export function operationalContributors(domains: DiagnosticDomain[], limit = 8): { contributors: OperationalContributor[]; omittedCount: number } {
  const all = domains.flatMap(domain => domain.state === "not-configured" ? [] : domain.checks.filter(check => check.status.tone === "negative" || check.status.tone === "warning").map(check => ({ id: `${domain.key}-${check.id}`, message: `${domain.title}: ${check.label} is ${check.status.label.toLowerCase()}.`, href: `#${check.id}` })));
  return { contributors: all.slice(0, Math.max(0, limit)), omittedCount: Math.max(0, all.length - Math.max(0, limit)) };
}
