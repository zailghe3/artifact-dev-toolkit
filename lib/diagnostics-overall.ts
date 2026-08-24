import type { RepositoryDiagnostics } from "./repository-diagnostics.ts";

export function deriveOverallDiagnosticsState(input: Pick<RepositoryDiagnostics, "configuration" | "authorization" | "permissions" | "repositoryRevision" | "cache" | "validation">): RepositoryDiagnostics["overall"] {
  const identityMissing = input.configuration.backend === "github" && (!input.configuration.owner || !input.configuration.repository);
  if (input.configuration.backend === "invalid" || identityMissing || Object.values(input.configuration.authSecrets).some(state => state !== "configured")) return "misconfigured";
  if (input.authorization.repositoryMatches === false || input.authorization.liveState === "denied") return "unauthorized";
  if (input.validation.state === "invalid") return "invalid_content";
  if (input.permissions.contentsRead.effective === false) return "unauthorized";
  if (input.repositoryRevision.state === "unavailable" || input.cache.state === "degraded" || input.cache.state === "unavailable") return "unavailable";
  if (input.permissions.contentsRead.effective === "unknown" || input.permissions.contentsWrite.effective !== true || input.authorization.liveState === "temporarily_unavailable" || input.cache.state === "stale" || input.cache.state === "missing" || input.cache.state === "corrupt" || input.validation.state === "unavailable") return "degraded";
  return "healthy";
}
