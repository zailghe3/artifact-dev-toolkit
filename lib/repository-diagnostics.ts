import type { SessionRecord } from "./auth-core.ts";
import { decryptUserAccessToken } from "./auth.ts";
import { getRepositoryAuthorizationConfig, verifyRepositoryAuthorization, type RepositoryAccessContext } from "./repository-authorization.ts";
import { getArtifactBaseRevision, getArtifactRepositoryDiagnostics, inspectArtifactCatalogueCache, inspectCatalogueCacheBinding } from "./artifacts.ts";
import { validateGitHubAppPrivateKey, type RepositoryCredential, type RepositoryCredentialCapability } from "./github-app.ts";
import { getPublicRepositoryConfiguration, storedRepositoryMatchesPublicConfiguration } from "./public-repository-configuration.ts";
import { ArtifactRepositoryAccessError, ArtifactRepositoryUnavailableError } from "./artifact-repository.ts";
import { classifyCapabilityResult, unknownPermissionCheck as unknownCheck, type PermissionCheck } from "./diagnostics-model.ts";
import { deriveOverallDiagnosticsState } from "./diagnostics-overall.ts";

export { classifyCapabilityResult } from "./diagnostics-model.ts";
export { deriveOverallDiagnosticsState } from "./diagnostics-overall.ts";
export type { PermissionCheck, PermissionReason } from "./diagnostics-model.ts";

type SettingState = "configured" | "missing" | "invalid";
export type RepositoryDiagnostics = {
  generatedAt: string; identity: { login: string; githubId: number; sessionState: "valid" };
  configuration: { backend: "github" | "file" | "invalid"; owner?: string; repository?: string; branch: string; artifactRoot: string; cacheBinding: SettingState; authSecrets: Record<string, SettingState> };
  authorization: { storedState: "authorized"; lastCheckedAt: string; repositoryMatches: boolean | "unknown"; repositoryIdPresent: boolean; installationIdPresent: boolean; liveState: "authorized" | "denied" | "temporarily_unavailable" | "not_checked"; reason?: string };
  installation: { state: "detected" | "missing" | "unavailable" | "unknown"; repositoryId?: number; installationId?: number };
  permissions: { contentsRead: PermissionCheck; contentsWrite: PermissionCheck; checkedAt?: string };
  repositoryRevision: { state: "available" | "unavailable" | "unknown"; value?: string; reason?: string };
  cache: { configured: boolean; state: "fresh" | "stale" | "missing" | "degraded" | "corrupt" | "unavailable"; revision?: string; refreshedAt?: string; ageSeconds?: number; artifactCount?: number; currentRevisionMatches?: boolean | "unknown"; reason?: string };
  validation: { state: "valid" | "invalid" | "unavailable" | "not_run"; revision?: string; validCount?: number; invalidCount?: number; errors?: Array<{ path: string; code: string; message: string }>; omittedErrorCount?: number; reason?: string };
  overall: "healthy" | "degraded" | "misconfigured" | "unauthorized" | "invalid_content" | "unavailable";
};

function presence(name: string): SettingState { return process.env[name]?.trim() ? "configured" : "missing"; }
async function safeConfiguration() {
  const publicConfig = getPublicRepositoryConfiguration();
  const names = ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "SESSION_SECRET"] as const;
  const authSecrets = Object.fromEntries(names.map((name) => [name, presence(name)])) as Record<string, SettingState>;
  if (authSecrets.SESSION_SECRET === "configured" && process.env.SESSION_SECRET!.trim().length < 32) authSecrets.SESSION_SECRET = "invalid";
  if (authSecrets.GITHUB_APP_PRIVATE_KEY === "configured") try { await validateGitHubAppPrivateKey(process.env.GITHUB_APP_PRIVATE_KEY!); } catch { authSecrets.GITHUB_APP_PRIVATE_KEY = "invalid"; }
  return { backend: publicConfig.backend, ...(publicConfig.owner ? { owner: publicConfig.owner } : {}), ...(publicConfig.repository ? { repository: publicConfig.repository } : {}), branch: publicConfig.branch, artifactRoot: publicConfig.root, cacheBinding: await inspectCatalogueCacheBinding(), authSecrets };
}

export type RepositoryAuthenticationDiagnostics = Pick<RepositoryDiagnostics,
  "generatedAt" | "identity" | "configuration" | "authorization" | "installation" | "permissions">;

async function observeRepositoryAccess(session: SessionRecord) {
  const generatedAt = new Date().toISOString();
  const stored = session.repositoryAuthorization;
  const configuration = await safeConfiguration();
  const publicConfig = getPublicRepositoryConfiguration();
  const repositoryMatches = storedRepositoryMatchesPublicConfiguration(stored, publicConfig);
  let config: ReturnType<typeof getRepositoryAuthorizationConfig> | undefined; try { config = getRepositoryAuthorizationConfig(); } catch { /* safe configuration still returned */ }
  let live: Awaited<ReturnType<typeof verifyRepositoryAuthorization>> | undefined;
  if (repositoryMatches === true && config && session.encryptedUserAccessToken && session.tokenIv && (session.userAccessTokenExpiresAt ?? 0) > Date.now()) try { live = await verifyRepositoryAuthorization({ id: session.githubId, login: session.login }, await decryptUserAccessToken(session), config); } catch { /* inconclusive */ }
  const liveState: RepositoryDiagnostics["authorization"]["liveState"] = live?.ok ? "authorized" : live ? (live.reason === "temporary_unavailable" ? "temporarily_unavailable" : "denied") : "not_checked";
  const definitiveDenial = repositoryMatches === false || (live && !live.ok && live.reason !== "temporary_unavailable");
  let access: RepositoryAccessContext | undefined = live?.ok ? live : undefined;
  if (!access && !definitiveDenial && repositoryMatches === true && config && stored.repositoryId && stored.installationId) {
    const { appId, privateKey } = config;
    const { repositoryId, installationId } = stored;
    const credentials = new Map<RepositoryCredentialCapability, Promise<RepositoryCredential>>();
    access = {
      ok: true, owner: stored.owner, repo: stored.repo, login: session.login, githubId: session.githubId,
      repositoryId, installationId, checkedAt: stored.checkedAt,
      installationCredentialProvider(capability) {
        let credential = credentials.get(capability);
        if (!credential) {
          credential = import("./github-app.ts").then(async ({ createGitHubAppJwt, mintInstallationToken }) =>
            mintInstallationToken(installationId, repositoryId, await createGitHubAppJwt(appId, privateKey), capability));
          credentials.set(capability, credential);
        }
        return credential;
      },
    };
  }
  const permissions = { contentsRead: unknownCheck(definitiveDenial ? "prerequisite_invalid" : "not_checked"), contentsWrite: unknownCheck(definitiveDenial ? "prerequisite_invalid" : "not_checked") } as RepositoryDiagnostics["permissions"];
  if (access) { const checks = await Promise.allSettled([access.installationCredentialProvider("read"), access.installationCredentialProvider("write")]); permissions.contentsRead = classifyCapabilityResult(checks[0], [["contents", ["read", "write", "admin"]]]); permissions.contentsWrite = classifyCapabilityResult(checks[1], [["contents", ["write", "admin"]]]); permissions.checkedAt = new Date().toISOString(); }
  const foundation: RepositoryAuthenticationDiagnostics = {
    generatedAt,
    identity: { login: session.login, githubId: session.githubId, sessionState: "valid" },
    configuration,
    authorization: {
      storedState: "authorized", lastCheckedAt: new Date(stored.checkedAt).toISOString(),
      repositoryMatches, repositoryIdPresent: Boolean(stored.repositoryId), installationIdPresent: Boolean(stored.installationId),
      liveState, ...(!live?.ok && live ? { reason: live.reason } : {}),
    },
    installation: {
      state: live?.ok ? "detected" : live && live.reason === "app_access" ? "missing" : liveState === "temporarily_unavailable" ? "unavailable" : "unknown",
      repositoryId: access?.repositoryId ?? stored.repositoryId, installationId: access?.installationId ?? stored.installationId,
    },
    permissions,
  };
  return { foundation, access, definitiveDenial };
}

async function observeRepositoryCatalogue(base: ReturnType<typeof observeRepositoryAccess>, includeValidation: boolean, signal?: AbortSignal): Promise<RepositoryDiagnostics> {
  const started = Date.now();
  const { foundation, access, definitiveDenial } = await base;
  const { permissions } = foundation;
  let revision: string | undefined; let revisionReason: string | undefined;
  if (access && permissions.contentsRead.effective === true) try { revision = await getArtifactBaseRevision(access); } catch (error) { revisionReason = error instanceof ArtifactRepositoryAccessError ? "access_denied" : error instanceof ArtifactRepositoryUnavailableError && error.status === 429 ? "rate_limited" : error instanceof ArtifactRepositoryUnavailableError ? "temporarily_unavailable" : "repository_revision_unavailable"; }
  const cache = access && !definitiveDenial ? await inspectArtifactCatalogueCache(access, revision) : { configured: foundation.configuration.cacheBinding === "configured", state: "unavailable" as const, reason: definitiveDenial ? "authorization_denied" : "repository_identity_invalid" };
  const configuration = {
    ...foundation.configuration,
    cacheBinding: cache.configured ? "configured" as const
      : cache.reason === "cache_binding_missing" ? "missing" as const : foundation.configuration.cacheBinding,
  };
  let validation: RepositoryDiagnostics["validation"] = { state: includeValidation ? "unavailable" : "not_run", ...(definitiveDenial ? { reason: "authorization_denied" } : {}) };
  if (includeValidation && access && revision && !definitiveDenial) try { const report = await getArtifactRepositoryDiagnostics(access, revision, signal); if (report) validation = { state: report.invalidCount ? "invalid" : "valid", ...report }; } catch (error) { validation = { state: "unavailable", revision, reason: error instanceof ArtifactRepositoryUnavailableError && error.status === 429 ? "rate_limited" : error instanceof ArtifactRepositoryAccessError ? "access_denied" : "repository_unavailable" }; }
  const partial = {
    ...foundation,
    configuration,
    repositoryRevision: revision ? { state: "available" as const, value: revision }
      : { state: access && !definitiveDenial ? "unavailable" as const : "unknown" as const, ...(revisionReason ? { reason: revisionReason } : {}) },
    cache: cache as RepositoryDiagnostics["cache"],
    validation,
  };
  const result: RepositoryDiagnostics = { ...partial, overall: deriveOverallDiagnosticsState(partial) };
  console.info(JSON.stringify({ event: "diagnostics_generated", overall: result.overall, durationMs: Date.now() - started, invalidCount: validation.invalidCount ?? 0 })); return result;
}


export function startRepositoryDiagnostics(session: SessionRecord, options: { includeValidation?: boolean } = {}) {
  const base = observeRepositoryAccess(session);
  return {
    authentication: base.then(({ foundation }) => foundation),
    report: observeRepositoryCatalogue(base, options.includeValidation === true),
  };
}

export async function generateRepositoryDiagnostics(session: SessionRecord, options: { includeValidation?: boolean; signal?: AbortSignal } = {}) {
  return observeRepositoryCatalogue(observeRepositoryAccess(session), options.includeValidation === true, options.signal);
}
