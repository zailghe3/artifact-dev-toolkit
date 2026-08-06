import type { PermissionCheck, PermissionReason } from "./diagnostics-model.ts";
import type { RepositoryDiagnostics } from "./repository-diagnostics.ts";

export type DiagnosticTone = "positive" | "warning" | "negative" | "neutral";
export type DiagnosticStatusPresentation = { label: string; tone: DiagnosticTone; description?: string };

const presentation = (label: string, tone: DiagnosticTone, description?: string): DiagnosticStatusPresentation => ({ label, tone, ...(description ? { description } : {}) });

export const overallStatusPresentation = (state: RepositoryDiagnostics["overall"]): DiagnosticStatusPresentation => ({
  healthy: presentation("Healthy", "positive", "All required repository, permission, cache, and validation checks completed successfully."),
  degraded: presentation("Degraded", "warning", "The application is usable, but one or more capabilities are impaired or could not be verified."),
  misconfigured: presentation("Misconfigured", "negative", "Required application or repository configuration is missing or invalid."),
  unauthorized: presentation("Unauthorized", "negative", "The current GitHub identity or App installation does not have the required repository access."),
  invalid_content: presentation("Invalid content", "negative", "Repository access is available, but one or more artifacts do not satisfy the artifact contract."),
  unavailable: presentation("Unavailable", "negative", "A required repository or catalogue service is currently unavailable."),
}[state]);

export const configurationStatusPresentation = (state: "configured" | "missing" | "invalid") => state === "configured" ? presentation("Configured", "positive") : presentation(state === "missing" ? "Missing" : "Invalid", "negative");
export const authorizationStatusPresentation = (state: "authorized" | "denied" | "temporarily_unavailable" | "not_checked") => ({
  authorized: presentation("Authorized", "positive"), denied: presentation("Denied", "negative"),
  temporarily_unavailable: presentation("Temporarily unavailable", "warning"), not_checked: presentation("Not checked", "warning"),
}[state]);
export const repositoryMatchPresentation = (state: boolean | "unknown") => state === true ? presentation("Match", "positive") : state === false ? presentation("Mismatch", "negative") : presentation("Unknown", "warning");
export const installationStatusPresentation = (state: RepositoryDiagnostics["installation"]["state"]) => ({
  detected: presentation("Detected", "positive"), missing: presentation("Missing", "negative"),
  unavailable: presentation("Unavailable", "warning"), unknown: presentation("Unknown", "warning"),
}[state]);

const permissionDescription = (reason: PermissionReason): string | undefined => ({
  capability_request_rejected: "The GitHub App installation could not mint the required proposal credential. Verify that Contents write and Pull requests write are granted to the App and approved for this repository.",
  permission_missing: "The required permission is not granted to the GitHub App installation for this repository.",
  malformed_response: "GitHub returned an unexpected credential response. Retry once; if it persists, inspect application logs using the safe diagnostic category.",
  temporarily_unavailable: "GitHub could not complete the permission check. Retry later.",
  rate_limited: "GitHub rate limited the permission check. Retry later.", authentication_failed: "GitHub App authentication failed; verify the App configuration.",
  installation_missing: "The GitHub App installation is not available for this repository.", request_failed: "GitHub rejected the credential request. Retry and verify the GitHub App configuration.",
  prerequisite_invalid: "A prerequisite repository or authorization check failed.", not_checked: "This permission has not been checked.", granted: undefined,
}[reason]);

export function permissionStatusPresentation(check: PermissionCheck): DiagnosticStatusPresentation {
  if (check.effective === true) return presentation("Granted", "positive");
  if (check.effective === false) return presentation("Denied", "negative", permissionDescription(check.reason));
  const label = check.reason === "temporarily_unavailable" ? "Temporarily unavailable" : check.reason === "rate_limited" ? "Rate limited" : check.reason === "authentication_failed" ? "Authentication failed" : "Unknown";
  const tone: DiagnosticTone = check.reason === "authentication_failed" ? "negative" : "warning";
  return presentation(label, tone, permissionDescription(check.reason));
}

export const revisionStatusPresentation = (state: RepositoryDiagnostics["repositoryRevision"]["state"]) => state === "available" ? presentation("Available", "positive") : state === "unknown" ? presentation("Unknown", "warning") : presentation("Unavailable", "negative");
export const cacheStatusPresentation = (state: RepositoryDiagnostics["cache"]["state"]) => state === "fresh" ? presentation("Fresh", "positive") : ["stale", "missing", "degraded"].includes(state) ? presentation(state[0].toUpperCase() + state.slice(1), "warning") : presentation(state[0].toUpperCase() + state.slice(1), "negative");
export const validationStatusPresentation = (state: RepositoryDiagnostics["validation"]["state"]) => state === "valid" ? presentation("Valid", "positive") : state === "invalid" ? presentation("Invalid", "negative") : presentation(state === "not_run" ? "Not run" : "Unavailable", "warning");

export type DiagnosticContributor = { id: string; message: string; href: string };
export type DiagnosticContributorSummary = { contributors: DiagnosticContributor[]; omittedCount: number };
export function diagnosticContributors(d: RepositoryDiagnostics, limit = 5): DiagnosticContributorSummary {
  if (d.overall === "healthy") return { contributors: [], omittedCount: 0 };
  const all: DiagnosticContributor[] = [];
  const add = (id: string, message: string) => { if (!all.some(item => item.id === id)) all.push({ id, message, href: `#${id}` }); };
  if (d.configuration.backend === "invalid" || (d.configuration.backend === "github" && (!d.configuration.owner || !d.configuration.repository))) add("repository-configuration", "Required repository configuration is missing or invalid.");
  if (Object.values(d.configuration.authSecrets).some(value => value !== "configured")) add("repository-configuration", "A required GitHub App setting is missing or invalid.");
  if (d.authorization.repositoryMatches === false) add("authorization", "The configured repository does not match the stored authorization.");
  if (d.authorization.liveState === "denied") add("authorization", "Live repository authorization was denied.");
  if (d.permissions.contentsRead.effective === false) add("permissions", "Contents read permission is not granted.");
  if (d.permissions.contentsWrite.effective === false) add("permissions-write", "Contents write permission is not granted.");
  if (d.permissions.pullRequestsWrite.effective === false) add("permissions-proposal", "The production proposal credential was denied.");
  else if (d.permissions.pullRequestsWrite.effective === "unknown") add("permissions-proposal", "Pull request creation permission could not be verified.");
  if (d.repositoryRevision.state !== "available") add("repository-revision", d.repositoryRevision.state === "unknown" ? "The repository revision was not checked." : "The repository revision is unavailable.");
  if (d.cache.state === "stale") add("catalogue-cache", "Catalogue data is stale.");
  else if (d.cache.state === "missing") add("catalogue-cache", "The catalogue snapshot is missing.");
  else if (d.cache.state !== "fresh") add("catalogue-cache", "Catalogue data is unavailable or corrupt.");
  if (d.validation.state === "invalid") add("artifact-validation", "One or more artifacts are invalid.");
  else if (d.validation.state !== "valid") add("artifact-validation", "Repository validation could not be completed.");
  return { contributors: all.slice(0, limit), omittedCount: Math.max(0, all.length - limit) };
}
