import type { ADTRuntimeDiagnostic } from "./adt-runtime-client.ts";
import type { SafeCodexConnectionStatus } from "./codex-runner-status.ts";
import type { DiagnosticStatusPresentation } from "./diagnostics-presentation.ts";
import type { RepositoryDiagnostics } from "./repository-diagnostics.ts";

export type DomainKey = "authentication-access" | "artifact-library" | "application-control-plane" | "adt-runtime" | "codex-runner";
export type DomainState = "healthy" | "degraded" | "failed" | "not-configured";
export type DiagnosticCheck = { id: string; label: string; status: DiagnosticStatusPresentation; value?: string; guidance?: string };
export type DiagnosticDomain = { key: DomainKey; title: string; state: DomainState; checks: DiagnosticCheck[] };
export type OperationalContributor = { id: string; message: string; href: string };

const status = (label: string, tone: DiagnosticStatusPresentation["tone"], description?: string): DiagnosticStatusPresentation => ({ label, tone, ...(description ? { description } : {}) });
const checkState = (checks: DiagnosticCheck[]): DomainState => checks.some(check => check.status.tone === "negative") ? "failed" : checks.some(check => check.status.tone === "warning" || check.status.tone === "neutral") ? "degraded" : "healthy";

export function runtimeDiagnosticChecks(runtime: ADTRuntimeDiagnostic): DiagnosticCheck[] {
  if (!runtime.configured) return [{ id: "runtime-configuration", label: "Configuration", status: status("Not configured", "neutral", "ADT Runtime is an optional execution boundary until configured.") }];
  const unknown = (id: string, label: string): DiagnosticCheck => ({ id, label, status: status("Not verified", "warning", "A prerequisite check did not complete successfully.") });
  const checks: DiagnosticCheck[] = [{ id: "runtime-configuration", label: "Configuration", status: status("Configured", "positive") }];
  checks.push({ id: "runtime-reachability", label: "Reachability", status: runtime.reachable ? status("Available", "positive") : status("Unavailable", "negative", "The Runtime readiness endpoint could not be reached."), ...(runtime.httpStatus ? { value: `HTTP ${runtime.httpStatus}` } : {}) });
  if (!runtime.reachable) return [...checks, unknown("runtime-authentication", "Request authentication"), unknown("runtime-protocol", "Protocol compatibility"), unknown("runtime-capability", "openai-agents capability"), unknown("runtime-wrapping-key", "Wrapping-key compatibility")];
  checks.push({ id: "runtime-authentication", label: "Request authentication", status: runtime.authenticationAccepted ? status("Accepted", "positive") : status("Rejected", "negative", "Verify the independently configured application-to-Runtime authentication boundary.") });
  if (!runtime.authenticationAccepted) return [...checks, unknown("runtime-protocol", "Protocol compatibility"), unknown("runtime-capability", "openai-agents capability"), unknown("runtime-wrapping-key", "Wrapping-key compatibility")];
  checks.push({ id: "runtime-protocol", label: "Protocol compatibility", status: runtime.protocolCompatible ? status("Compatible", "positive") : status("Incompatible", "negative", "Deploy a Runtime version compatible with this application.") });
  if (!runtime.protocolCompatible) return [...checks, unknown("runtime-capability", "openai-agents capability"), unknown("runtime-wrapping-key", "Wrapping-key compatibility")];
  checks.push({ id: "runtime-capability", label: "openai-agents capability", status: runtime.capabilityAvailable ? status("Available", "positive") : status("Unavailable", "negative", "The deployed Runtime does not advertise the required capability.") });
  if (!runtime.capabilityAvailable) return [...checks, unknown("runtime-wrapping-key", "Wrapping-key compatibility")];
  checks.push({ id: "runtime-wrapping-key", label: "Wrapping-key compatibility", status: runtime.wrappingKeyMatches ? status("Compatible", "positive") : status("Mismatch", "negative", "The application and Runtime wrapping-key configuration do not match.") });
  if (runtime.runtimeRevision) checks.push({ id: "runtime-revision", label: "Runtime revision", status: status("Observed", "positive"), value: runtime.runtimeRevision.slice(0, 12) });
  checks.push({ id: "runtime-elapsed", label: "Readiness elapsed time", status: status("Observed", "positive"), value: `${runtime.elapsedMs} ms` });
  return checks;
}

export function runnerDiagnosticChecks(runner: SafeCodexConnectionStatus): DiagnosticCheck[] {
  if (runner.state === "configuration-missing") return [{ id: "runner-configuration", label: "Configuration", status: status("Not configured", "neutral", "Codex Runner is an optional execution boundary until configured.") }];
  if (runner.state === "unavailable") return [{ id: "runner-configuration", label: "Configuration", status: status("Configured", "positive") }, { id: "runner-reachability", label: "Reachability", status: status("Unavailable", "negative", "Open the detailed Runner status for bounded operational diagnostics.") }];
  if (runner.state === "update-required") return [{ id: "runner-reachability", label: "Reachability", status: status("Available", "positive") }, { id: "runner-protocol", label: "Protocol compatibility", status: status("Update required", "negative", "Deploy the expected Runner release before execution.") }];
  const capabilities = runner.capabilities;
  const compatibility = runner.compatibility;
  return [
    { id: "runner-reachability", label: "Reachability", status: status("Available", "positive") },
    { id: "runner-protocol", label: "Protocol compatibility", status: compatibility?.protocol === "compatible" ? status("Compatible", "positive") : status(compatibility?.protocol === "incompatible" ? "Incompatible" : "Unknown", compatibility?.protocol === "incompatible" ? "negative" : "warning") },
    { id: "runner-revision", label: "Runner revision", status: compatibility?.runnerRevision === "current" ? status("Current", "positive") : status(compatibility?.runnerRevision === "unknown" ? "Unknown" : "Update required", compatibility?.runnerRevision === "unknown" ? "warning" : "negative"), ...(capabilities?.releaseMetadata === "current" ? { value: String(capabilities.runnerRevision) } : {}) },
    { id: "runner-codex-cli", label: "Codex CLI", status: capabilities?.codexAvailable ? status("Available", "positive") : status("Unavailable", "negative"), ...(capabilities?.releaseMetadata === "current" ? { value: capabilities.codexVersion } : {}) },
    { id: "runner-device-auth", label: "Device authentication", status: capabilities?.deviceAuth ? status("Available", "positive") : status("Unavailable", "negative") },
    { id: "runner-job-execution", label: "Job execution", status: capabilities?.jobExecution ? status("Available", "positive") : status("Unavailable", "negative") },
    { id: "runner-authentication", label: "Codex authentication", status: runner.state === "connected" ? status("Connected", "positive") : status("Disconnected", "warning", "Connect the Runner to ChatGPT from the existing connection interface.") },
  ];
}

export function deriveOperationalDomains(repository: RepositoryDiagnostics | null, runtime: ADTRuntimeDiagnostic, runner: SafeCodexConnectionStatus, deploymentConfigured: boolean): DiagnosticDomain[] {
  const unavailable = (id: string, label: string): DiagnosticCheck => ({ id, label, status: status("Unavailable", "negative", "This domain could not be evaluated safely.") });
  const authChecks: DiagnosticCheck[] = repository ? [
    { id: "session", label: "Signed-in session", status: status("Valid", "positive"), value: `@${repository.identity.login} · GitHub ID ${repository.identity.githubId}` },
    { id: "authorization", label: "Live repository authorisation", status: repository.authorization.liveState === "authorized" ? status("Authorized", "positive") : repository.authorization.liveState === "denied" ? status("Denied", "negative") : status(repository.authorization.liveState === "not_checked" ? "Not checked" : "Unavailable", "warning") },
    { id: "installation", label: "GitHub App installation", status: repository.installation.state === "detected" ? status("Detected", "positive") : status(repository.installation.state === "missing" ? "Missing" : "Unknown", repository.installation.state === "missing" ? "negative" : "warning") },
    { id: "permissions", label: "Contents read", status: repository.permissions.contentsRead.effective === true ? status("Granted", "positive") : repository.permissions.contentsRead.effective === false ? status("Denied", "negative") : status("Unknown", "warning") },
    { id: "permissions-write", label: "Contents write", status: repository.permissions.contentsWrite.effective === true ? status("Granted", "positive") : repository.permissions.contentsWrite.effective === false ? status("Denied", "negative") : status("Unknown", "warning") },
  ] : [unavailable("authentication-diagnostics", "Authentication diagnostics")];
  const artifactChecks: DiagnosticCheck[] = repository ? [
    { id: "artifact-repository", label: "Artifact repository", status: repository.configuration.backend === "invalid" ? status("Invalid", "negative") : status("Configured", "positive") },
    { id: "repository-revision", label: "Repository revision", status: repository.repositoryRevision.state === "available" ? status("Available", "positive") : status(repository.repositoryRevision.state === "unknown" ? "Unknown" : "Unavailable", repository.repositoryRevision.state === "unknown" ? "warning" : "negative"), value: repository.repositoryRevision.value?.slice(0, 12) },
    { id: "catalogue-cache", label: "Catalogue/cache", status: repository.cache.state === "fresh" ? status("Fresh", "positive") : status(repository.cache.state[0].toUpperCase() + repository.cache.state.slice(1), ["stale", "missing", "degraded"].includes(repository.cache.state) ? "warning" : "negative") },
    { id: "artifact-validation", label: "Content validation", status: repository.validation.state === "valid" ? status("Valid", "positive") : status(repository.validation.state === "not_run" ? "Not run" : repository.validation.state === "invalid" ? "Invalid" : "Unavailable", repository.validation.state === "invalid" ? "negative" : "warning") },
  ] : [unavailable("artifact-library-diagnostics", "Artifact Library diagnostics")];
  const runtimeChecks = runtimeDiagnosticChecks(runtime), runnerChecks = runnerDiagnosticChecks(runner);
  const domains: DiagnosticDomain[] = [
    { key: "authentication-access", title: "Authentication & access", state: checkState(authChecks), checks: authChecks },
    { key: "artifact-library", title: "Artifact Library", state: checkState(artifactChecks), checks: artifactChecks },
    { key: "application-control-plane", title: "Application / control plane", state: "healthy", checks: [{ id: "deployment-identity", label: "Deployment identity", status: deploymentConfigured ? status("Available", "positive") : status("Development build", "neutral") }] },
    { key: "adt-runtime", title: "ADT Runtime", state: runtime.configured ? checkState(runtimeChecks) : "not-configured", checks: runtimeChecks },
    { key: "codex-runner", title: "Codex Runner", state: runner.state === "configuration-missing" ? "not-configured" : checkState(runnerChecks), checks: runnerChecks },
  ];
  return domains;
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
