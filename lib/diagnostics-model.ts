import type { RepositoryDiagnostics } from "./repository-diagnostics.ts";

export type PermissionReason = "granted" | "permission_missing" | "installation_missing" | "authentication_failed" | "temporarily_unavailable" | "rate_limited" | "malformed_response" | "prerequisite_invalid" | "not_checked";
export type PermissionCheck = { effective: boolean | "unknown"; reason: PermissionReason };
export const unknownPermissionCheck = (reason: PermissionReason = "not_checked"): PermissionCheck => ({ effective: "unknown", reason });

export type CatalogueRefreshUnavailableReason = "local_backend" | "cache_binding_missing" | "repository_identity_missing" | "installation_identity_missing" | "authorization_unavailable" | "authentication_unavailable" | "read_permission_missing" | "read_permission_unverified" | "configuration_invalid";
export type CatalogueRefreshAvailability = { available: true } | { available: false; reason: CatalogueRefreshUnavailableReason };

export function catalogueRefreshAvailability(diagnostics: Pick<RepositoryDiagnostics, "configuration" | "authorization" | "permissions">): CatalogueRefreshAvailability {
  const { configuration, authorization, permissions } = diagnostics;
  if (configuration.backend === "file") return { available: false, reason: "local_backend" };
  if (configuration.backend !== "github" || !configuration.owner || !configuration.repository || !configuration.branch || !configuration.artifactRoot) return { available: false, reason: "configuration_invalid" };
  if (configuration.cacheBinding !== "configured") return { available: false, reason: "cache_binding_missing" };
  const requiredRefreshSettings = ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_TOKEN_ENCRYPTION_KEY"];
  if (requiredRefreshSettings.some((name) => configuration.authSecrets[name] !== "configured")) return { available: false, reason: "configuration_invalid" };
  if (!authorization.repositoryIdPresent) return { available: false, reason: "repository_identity_missing" };
  if (!authorization.installationIdPresent) return { available: false, reason: "installation_identity_missing" };
  if (authorization.repositoryMatches === false || authorization.liveState === "denied") return { available: false, reason: "authorization_unavailable" };
  if (permissions.contentsRead.effective === false) return { available: false, reason: "read_permission_missing" };
  if (permissions.contentsRead.effective === true) return { available: true };
  if (permissions.contentsRead.reason === "rate_limited" || permissions.contentsRead.reason === "temporarily_unavailable") return { available: true };
  if (permissions.contentsRead.reason === "authentication_failed") return { available: false, reason: "authentication_unavailable" };
  return { available: false, reason: "read_permission_unverified" };
}

export function classifyCapabilityResult(result: PromiseSettledResult<{ permissions?: Record<string, string> }>, required: Array<[string, string[]]>): PermissionCheck {
  if (result.status === "rejected") {
    const status = (result.reason as { status?: number }).status;
    if (status === 401) return unknownPermissionCheck("authentication_failed");
    if (status === 403 || status === 404) return { effective: false, reason: "installation_missing" };
    if (status === 429) return unknownPermissionCheck("rate_limited");
    if (typeof status === "number" && status >= 500) return unknownPermissionCheck("temporarily_unavailable");
    return unknownPermissionCheck("malformed_response");
  }
  const permissions = result.value.permissions;
  if (!permissions || typeof permissions !== "object") return unknownPermissionCheck("malformed_response");
  const granted = required.every(([name, levels]) => levels.includes(permissions[name] ?? ""));
  return { effective: granted, reason: granted ? "granted" : "permission_missing" };
}
