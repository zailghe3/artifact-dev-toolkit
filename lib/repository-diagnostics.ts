import type { SessionRecord } from "./auth-core.ts";
import { decryptUserAccessToken } from "./auth.ts";
import { getRepositoryAuthorizationConfig, verifyRepositoryAuthorization, type RepositoryAccessContext } from "./repository-authorization.ts";
import { getArtifactBaseRevision, getArtifactRepositoryDiagnostics, inspectArtifactCatalogueCache } from "./artifacts.ts";
import { getArtifactRepositoryBackend } from "./artifact-repository.ts";
import { validateGitHubAppPrivateKey } from "./github-app.ts";
import { validateTokenEncryptionKey } from "./auth-configuration.ts";

type SettingState = "configured" | "missing" | "invalid";
export type RepositoryDiagnostics = {
  generatedAt: string; identity: { login: string; githubId: number; sessionState: "valid" };
  configuration: { backend: "github" | "file" | "invalid"; owner?: string; repository?: string; branch?: string; artifactRoot?: string; cacheBinding: SettingState; authSecrets: Record<string, SettingState> };
  authorization: { storedState: "authorized"; lastCheckedAt: string; repositoryMatches: boolean | "unknown"; repositoryIdPresent: boolean; installationIdPresent: boolean; liveState: "authorized" | "denied" | "temporarily_unavailable" | "not_checked"; reason?: string };
  installation: { state: "detected" | "missing" | "unavailable" | "unknown"; repositoryId?: number; installationId?: number };
  permissions: { contentsRead: boolean | "unknown"; contentsWrite: boolean | "unknown"; pullRequestsWrite: boolean | "unknown"; checkedAt?: string; reasons?: Record<string, string> };
  repositoryRevision: { state: "available" | "unavailable" | "unknown"; value?: string; reason?: string };
  cache: { configured: boolean; state: "fresh" | "stale" | "missing" | "degraded" | "corrupt" | "unavailable"; revision?: string; refreshedAt?: string; ageSeconds?: number; artifactCount?: number; currentRevisionMatches?: boolean | "unknown"; reason?: string };
  validation: { state: "valid" | "invalid" | "unavailable" | "not_run"; revision?: string; validCount?: number; invalidCount?: number; errors?: Array<{ path: string; code: string; message: string }>; omittedErrorCount?: number };
  overall: "healthy" | "degraded" | "misconfigured" | "unauthorized" | "invalid_content" | "unavailable";
};

function presence(name: string): SettingState { return process.env[name]?.trim() ? "configured" : "missing"; }
async function safeConfiguration() {
  const names = ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_TOKEN_ENCRYPTION_KEY", "SESSION_SECRET"] as const;
  const authSecrets = Object.fromEntries(names.map((name) => [name, presence(name)])) as Record<string, SettingState>;
  if (authSecrets.SESSION_SECRET === "configured" && process.env.SESSION_SECRET!.trim().length < 32) authSecrets.SESSION_SECRET = "invalid";
  if (authSecrets.GITHUB_TOKEN_ENCRYPTION_KEY === "configured") try { validateTokenEncryptionKey(process.env.GITHUB_TOKEN_ENCRYPTION_KEY!); } catch { authSecrets.GITHUB_TOKEN_ENCRYPTION_KEY = "invalid"; }
  if (authSecrets.GITHUB_APP_PRIVATE_KEY === "configured") try { await validateGitHubAppPrivateKey(process.env.GITHUB_APP_PRIVATE_KEY!); } catch { authSecrets.GITHUB_APP_PRIVATE_KEY = "invalid"; }
  let backend: "github" | "file" | "invalid" = "invalid"; try { backend = getArtifactRepositoryBackend(); } catch { /* safe */ }
  return { backend, ...(process.env.GITHUB_ARTIFACT_REPOSITORY_OWNER?.trim() ? { owner: process.env.GITHUB_ARTIFACT_REPOSITORY_OWNER.trim() } : {}), ...(process.env.GITHUB_ARTIFACT_REPOSITORY_NAME?.trim() ? { repository: process.env.GITHUB_ARTIFACT_REPOSITORY_NAME.trim() } : {}), branch: process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH?.trim() || "main", artifactRoot: process.env.GITHUB_ARTIFACT_REPOSITORY_ROOT?.trim().replace(/^\/+|\/+$/g, "") || "artifacts", cacheBinding: presence("ARTIFACT_CATALOGUE_CACHE"), authSecrets };
}

export async function generateRepositoryDiagnostics(session: SessionRecord): Promise<RepositoryDiagnostics> {
  const started = Date.now(); const generatedAt = new Date().toISOString(); const stored = session.repositoryAuthorization; const configuration = await safeConfiguration();
  let config: ReturnType<typeof getRepositoryAuthorizationConfig> | undefined; try { config = getRepositoryAuthorizationConfig(); } catch { /* reported independently */ }
  const repositoryMatches = config ? stored.owner.toLowerCase() === config.owner.toLowerCase() && stored.repo.toLowerCase() === config.repo.toLowerCase() : "unknown";
  let live: Awaited<ReturnType<typeof verifyRepositoryAuthorization>> | undefined;
  if (config && session.encryptedUserAccessToken && session.tokenIv && (session.userAccessTokenExpiresAt ?? 0) > Date.now()) try { live = await verifyRepositoryAuthorization({ id: session.githubId, login: session.login }, await decryptUserAccessToken(session), config); } catch { /* observational */ }
  const liveState = live?.ok ? "authorized" : live ? (live.reason === "temporary_unavailable" ? "temporarily_unavailable" : "denied") : "not_checked";
  const access: RepositoryAccessContext | undefined = live?.ok ? live : config ? { ok: true, owner: stored.owner, repo: stored.repo, login: session.login, githubId: session.githubId, repositoryId: stored.repositoryId!, installationId: stored.installationId!, checkedAt: stored.checkedAt, installationCredentialProvider: async (capability) => { const { createGitHubAppJwt, mintInstallationToken } = await import("./github-app.ts"); return mintInstallationToken(stored.installationId!, stored.repositoryId!, await createGitHubAppJwt(config!.appId, config!.privateKey), capability); } } : undefined;
  const permissions: RepositoryDiagnostics["permissions"] = { contentsRead: "unknown", contentsWrite: "unknown", pullRequestsWrite: "unknown" };
  if (access) { const checks = await Promise.allSettled([access.installationCredentialProvider("read"), access.installationCredentialProvider("write"), access.installationCredentialProvider("proposal")]); const read = checks[0].status === "fulfilled" ? checks[0].value.permissions : undefined; const write = checks[1].status === "fulfilled" ? checks[1].value.permissions : undefined; const proposal = checks[2].status === "fulfilled" ? checks[2].value.permissions : undefined; permissions.contentsRead = read ? ["read", "write", "admin"].includes(read.contents ?? "") : "unknown"; permissions.contentsWrite = write ? ["write", "admin"].includes(write.contents ?? "") : "unknown"; permissions.pullRequestsWrite = proposal ? ["write", "admin"].includes(proposal.pullRequests ?? "") && ["write", "admin"].includes(proposal.contents ?? "") : "unknown"; permissions.checkedAt = new Date().toISOString(); }
  let revision: string | undefined; let revisionReason: string | undefined;
  if (access && permissions.contentsRead === true) try { revision = await getArtifactBaseRevision(access); } catch { revisionReason = "repository_revision_unavailable"; }
  const cache = access ? await inspectArtifactCatalogueCache(access, revision) : { configured: false as const, state: "unavailable" as const, reason: "configuration_invalid" };
  configuration.cacheBinding = cache.configured ? "configured" : "missing";
  let validation: RepositoryDiagnostics["validation"] = { state: "not_run" };
  if (access && revision) try { const report = await getArtifactRepositoryDiagnostics(access, revision); if (report) validation = { state: report.invalidCount ? "invalid" : "valid", ...report }; } catch { validation = { state: "unavailable", revision }; }
  const misconfigured = configuration.backend === "invalid" || Object.values(configuration.authSecrets).some((state) => state !== "configured");
  const overall = misconfigured ? "misconfigured" : validation.state === "invalid" ? "invalid_content" : liveState === "denied" ? "unauthorized" : !revision || cache.state === "degraded" || cache.state === "unavailable" ? "unavailable" : liveState === "temporarily_unavailable" || cache.state === "stale" || cache.state === "missing" || cache.state === "corrupt" ? "degraded" : "healthy";
  const result: RepositoryDiagnostics = { generatedAt, identity: { login: session.login, githubId: session.githubId, sessionState: "valid" }, configuration, authorization: { storedState: "authorized", lastCheckedAt: new Date(stored.checkedAt).toISOString(), repositoryMatches, repositoryIdPresent: true, installationIdPresent: true, liveState, ...(!live?.ok && live ? { reason: live.reason } : {}) }, installation: { state: live?.ok ? "detected" : live && live.reason === "app_access" ? "missing" : liveState === "temporarily_unavailable" ? "unavailable" : "unknown", repositoryId: stored.repositoryId, installationId: stored.installationId }, permissions, repositoryRevision: revision ? { state: "available", value: revision } : { state: access ? "unavailable" : "unknown", ...(revisionReason ? { reason: revisionReason } : {}) }, cache: cache as RepositoryDiagnostics["cache"], validation, overall };
  console.info(JSON.stringify({ event: "diagnostics_generated", owner: configuration.owner, repository: configuration.repository, repositoryId: stored.repositoryId, installationId: stored.installationId, overall, durationMs: Date.now() - started, invalidCount: validation.invalidCount ?? 0 })); return result;
}
