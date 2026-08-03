import type { SessionRecord } from "./auth-core.ts";
import { decryptUserAccessToken } from "./auth.ts";
import { getRepositoryAuthorizationConfig, verifyRepositoryAuthorization, type RepositoryAccessContext } from "./repository-authorization.ts";
import { getArtifactBaseRevision, getArtifactRepositoryDiagnostics, inspectArtifactCatalogueCache, inspectCatalogueCacheBinding } from "./artifacts.ts";
import { validateGitHubAppPrivateKey } from "./github-app.ts";
import { validateTokenEncryptionKey } from "./auth-configuration.ts";
import { getPublicRepositoryConfiguration, storedRepositoryMatchesPublicConfiguration } from "./public-repository-configuration.ts";
import { ArtifactRepositoryAccessError, ArtifactRepositoryUnavailableError } from "./artifact-repository.ts";
import { classifyCapabilityResult, unknownPermissionCheck as unknownCheck, type PermissionCheck } from "./diagnostics-model.ts";

export { classifyCapabilityResult } from "./diagnostics-model.ts";
export type { PermissionCheck, PermissionReason } from "./diagnostics-model.ts";

type SettingState = "configured" | "missing" | "invalid";
export type RepositoryDiagnostics = {
  generatedAt: string; identity: { login: string; githubId: number; sessionState: "valid" };
  configuration: { backend: "github" | "file" | "invalid"; owner?: string; repository?: string; branch: string; artifactRoot: string; cacheBinding: SettingState; authSecrets: Record<string, SettingState> };
  authorization: { storedState: "authorized"; lastCheckedAt: string; repositoryMatches: boolean | "unknown"; repositoryIdPresent: boolean; installationIdPresent: boolean; liveState: "authorized" | "denied" | "temporarily_unavailable" | "not_checked"; reason?: string };
  installation: { state: "detected" | "missing" | "unavailable" | "unknown"; repositoryId?: number; installationId?: number };
  permissions: { contentsRead: PermissionCheck; contentsWrite: PermissionCheck; pullRequestsWrite: PermissionCheck; checkedAt?: string };
  repositoryRevision: { state: "available" | "unavailable" | "unknown"; value?: string; reason?: string };
  cache: { configured: boolean; state: "fresh" | "stale" | "missing" | "degraded" | "corrupt" | "unavailable"; revision?: string; refreshedAt?: string; ageSeconds?: number; artifactCount?: number; currentRevisionMatches?: boolean | "unknown"; reason?: string };
  validation: { state: "valid" | "invalid" | "unavailable" | "not_run"; revision?: string; validCount?: number; invalidCount?: number; errors?: Array<{ path: string; code: string; message: string }>; omittedErrorCount?: number; reason?: string };
  overall: "healthy" | "degraded" | "misconfigured" | "unauthorized" | "invalid_content" | "unavailable";
};

function presence(name: string): SettingState { return process.env[name]?.trim() ? "configured" : "missing"; }
async function safeConfiguration() {
  const publicConfig = getPublicRepositoryConfiguration();
  const names = ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_TOKEN_ENCRYPTION_KEY", "SESSION_SECRET"] as const;
  const authSecrets = Object.fromEntries(names.map((name) => [name, presence(name)])) as Record<string, SettingState>;
  if (authSecrets.SESSION_SECRET === "configured" && process.env.SESSION_SECRET!.trim().length < 32) authSecrets.SESSION_SECRET = "invalid";
  if (authSecrets.GITHUB_TOKEN_ENCRYPTION_KEY === "configured") try { validateTokenEncryptionKey(process.env.GITHUB_TOKEN_ENCRYPTION_KEY!); } catch { authSecrets.GITHUB_TOKEN_ENCRYPTION_KEY = "invalid"; }
  if (authSecrets.GITHUB_APP_PRIVATE_KEY === "configured") try { await validateGitHubAppPrivateKey(process.env.GITHUB_APP_PRIVATE_KEY!); } catch { authSecrets.GITHUB_APP_PRIVATE_KEY = "invalid"; }
  return { backend: publicConfig.backend, ...(publicConfig.owner ? { owner: publicConfig.owner } : {}), ...(publicConfig.repository ? { repository: publicConfig.repository } : {}), branch: publicConfig.branch, artifactRoot: publicConfig.root, cacheBinding: await inspectCatalogueCacheBinding(), authSecrets };
}

export function deriveOverallDiagnosticsState(input: Pick<RepositoryDiagnostics, "configuration" | "authorization" | "permissions" | "repositoryRevision" | "cache" | "validation">): RepositoryDiagnostics["overall"] {
  const identityMissing = input.configuration.backend === "github" && (!input.configuration.owner || !input.configuration.repository);
  if (input.configuration.backend === "invalid" || identityMissing || Object.values(input.configuration.authSecrets).some(state => state !== "configured")) return "misconfigured";
  if (input.authorization.repositoryMatches === false || input.authorization.liveState === "denied") return "unauthorized";
  if (input.validation.state === "invalid") return "invalid_content";
  if (input.permissions.contentsRead.effective === false) return "unauthorized";
  if (input.repositoryRevision.state === "unavailable" || input.cache.state === "degraded" || input.cache.state === "unavailable") return "unavailable";
  if (input.permissions.contentsRead.effective === "unknown" || input.permissions.contentsWrite.effective !== true || input.permissions.pullRequestsWrite.effective !== true || input.authorization.liveState === "temporarily_unavailable" || input.cache.state === "stale" || input.cache.state === "missing" || input.cache.state === "corrupt" || input.validation.state === "unavailable") return "degraded";
  return "healthy";
}

export async function generateRepositoryDiagnostics(session: SessionRecord): Promise<RepositoryDiagnostics> {
  const started = Date.now(); const generatedAt = new Date().toISOString(); const stored = session.repositoryAuthorization; const configuration = await safeConfiguration();
  const publicConfig = getPublicRepositoryConfiguration(); const repositoryMatches = storedRepositoryMatchesPublicConfiguration(stored, publicConfig);
  let config: ReturnType<typeof getRepositoryAuthorizationConfig> | undefined; try { config = getRepositoryAuthorizationConfig(); } catch { /* safe configuration still returned */ }
  let live: Awaited<ReturnType<typeof verifyRepositoryAuthorization>> | undefined;
  if (repositoryMatches === true && config && session.encryptedUserAccessToken && session.tokenIv && (session.userAccessTokenExpiresAt ?? 0) > Date.now()) try { live = await verifyRepositoryAuthorization({ id: session.githubId, login: session.login }, await decryptUserAccessToken(session), config); } catch { /* inconclusive */ }
  const liveState: RepositoryDiagnostics["authorization"]["liveState"] = live?.ok ? "authorized" : live ? (live.reason === "temporary_unavailable" ? "temporarily_unavailable" : "denied") : "not_checked";
  const definitiveDenial = repositoryMatches === false || (live && !live.ok && live.reason !== "temporary_unavailable");
  let access: RepositoryAccessContext | undefined = live?.ok ? live : undefined;
  if (!access && !definitiveDenial && repositoryMatches === true && config && stored.repositoryId && stored.installationId) access = { ok: true, owner: stored.owner, repo: stored.repo, login: session.login, githubId: session.githubId, repositoryId: stored.repositoryId, installationId: stored.installationId, checkedAt: stored.checkedAt, installationCredentialProvider: async (capability) => { const { createGitHubAppJwt, mintInstallationToken } = await import("./github-app.ts"); return mintInstallationToken(stored.installationId!, stored.repositoryId!, await createGitHubAppJwt(config!.appId, config!.privateKey), capability); } };
  const permissions = { contentsRead: unknownCheck(definitiveDenial ? "prerequisite_invalid" : "not_checked"), contentsWrite: unknownCheck(definitiveDenial ? "prerequisite_invalid" : "not_checked"), pullRequestsWrite: unknownCheck(definitiveDenial ? "prerequisite_invalid" : "not_checked") } as RepositoryDiagnostics["permissions"];
  if (access) { const checks = await Promise.allSettled([access.installationCredentialProvider("read"), access.installationCredentialProvider("write"), access.installationCredentialProvider("proposal")]); permissions.contentsRead = classifyCapabilityResult(checks[0], [["contents", ["read", "write", "admin"]]]); permissions.contentsWrite = classifyCapabilityResult(checks[1], [["contents", ["write", "admin"]]]); permissions.pullRequestsWrite = classifyCapabilityResult(checks[2], [["contents", ["write", "admin"]], ["pullRequests", ["write", "admin"]]]); permissions.checkedAt = new Date().toISOString(); }
  let revision: string | undefined; let revisionReason: string | undefined;
  if (access && permissions.contentsRead.effective === true) try { revision = await getArtifactBaseRevision(access); } catch (error) { revisionReason = error instanceof ArtifactRepositoryAccessError ? "access_denied" : error instanceof ArtifactRepositoryUnavailableError && error.status === 429 ? "rate_limited" : error instanceof ArtifactRepositoryUnavailableError ? "temporarily_unavailable" : "repository_revision_unavailable"; }
  const cache = access && !definitiveDenial ? await inspectArtifactCatalogueCache(access, revision) : { configured: configuration.cacheBinding === "configured", state: "unavailable" as const, reason: definitiveDenial ? "authorization_denied" : "repository_identity_invalid" };
  if (cache.configured) configuration.cacheBinding = "configured";
  else if (cache.reason === "cache_binding_missing") configuration.cacheBinding = "missing";
  let validation: RepositoryDiagnostics["validation"] = { state: "not_run", ...(definitiveDenial ? { reason: "authorization_denied" } : {}) };
  if (access && revision && !definitiveDenial) try { const report = await getArtifactRepositoryDiagnostics(access, revision); if (report) validation = { state: report.invalidCount ? "invalid" : "valid", ...report }; } catch (error) { validation = { state: "unavailable", revision, reason: error instanceof ArtifactRepositoryUnavailableError && error.status === 429 ? "rate_limited" : error instanceof ArtifactRepositoryAccessError ? "access_denied" : "repository_unavailable" }; }
  const partial = { configuration, authorization: { storedState: "authorized" as const, lastCheckedAt: new Date(stored.checkedAt).toISOString(), repositoryMatches, repositoryIdPresent: Boolean(stored.repositoryId), installationIdPresent: Boolean(stored.installationId), liveState, ...(!live?.ok && live ? { reason: live.reason } : {}) }, installation: { state: live?.ok ? "detected" as const : live && live.reason === "app_access" ? "missing" as const : liveState === "temporarily_unavailable" ? "unavailable" as const : "unknown" as const, repositoryId: access?.repositoryId ?? stored.repositoryId, installationId: access?.installationId ?? stored.installationId }, permissions, repositoryRevision: revision ? { state: "available" as const, value: revision } : { state: access && !definitiveDenial ? "unavailable" as const : "unknown" as const, ...(revisionReason ? { reason: revisionReason } : {}) }, cache: cache as RepositoryDiagnostics["cache"], validation };
  const result: RepositoryDiagnostics = { generatedAt, identity: { login: session.login, githubId: session.githubId, sessionState: "valid" }, ...partial, overall: deriveOverallDiagnosticsState(partial) };
  console.info(JSON.stringify({ event: "diagnostics_generated", overall: result.overall, durationMs: Date.now() - started, invalidCount: validation.invalidCount ?? 0 })); return result;
}
