import { noStoreHeaders, type SessionRecord } from "./auth-core.ts";
import { createGitHubAppJwt, getConfiguredRepository, getRepositoryInstallation, mintInstallationToken, type GitHubAppConfig } from "./github-app.ts";

export const authorizationFreshnessMs = 7 * 60 * 1000;
export type RepositoryAuthorizationFailureReason = "configuration" | "allowlist" | "app_access" | "user_access" | "temporary_unavailable";
export type RepositoryAuthorizationStatus =
  | { ok: true; owner: string; repo: string; login: string; githubId: number; repositoryId: number; installationId: number; checkedAt: number; installationTokenProvider: () => Promise<string> }
  | { ok: false; reason: RepositoryAuthorizationFailureReason; message: string; temporary?: boolean };
export type RepositoryAccessContext = Extract<RepositoryAuthorizationStatus, { ok: true }>;

export function authorizationRequiresRevalidation(authorization: SessionRecord["repositoryAuthorization"], now = Date.now()) {
  return authorization.denialReason === "temporary_unavailable" || now - authorization.checkedAt >= authorizationFreshnessMs;
}

export function shouldRetainUserToken(status: RepositoryAuthorizationStatus) {
  return status.ok || status.reason === "temporary_unavailable";
}

export class RepositoryAccessError extends Error {
  readonly reason: RepositoryAuthorizationFailureReason;
  constructor(reason: RepositoryAuthorizationFailureReason) {
    super(repositoryAccessDeniedMessages[reason]);
    this.reason = reason;
    this.name = "RepositoryAccessError";
  }
}

export const repositoryAccessDeniedMessages: Record<RepositoryAuthorizationFailureReason, string> = {
  configuration: "Artifact repository access is not configured. Contact an administrator.",
  allowlist: "Your GitHub account is not on the artifact library allowlist.",
  app_access: "The GitHub App is not installed with access to the configured artifact repository.",
  user_access: "Your GitHub account is not authorised for the configured artifact repository.",
  temporary_unavailable: "Artifact repository authorisation is temporarily unavailable. Please try again later.",
};

export function parseAllowedGitHubLogins(value = process.env.GITHUB_ARTIFACT_ALLOWED_LOGINS ?? "") { return value.split(",").map((login) => login.trim().toLowerCase()).filter(Boolean); }

export function getRepositoryAuthorizationConfig(): GitHubAppConfig {
  const env = process.env;
  const required = ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_TOKEN_ENCRYPTION_KEY", "GITHUB_ARTIFACT_REPOSITORY_OWNER", "GITHUB_ARTIFACT_REPOSITORY_NAME"] as const;
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing GitHub App repository authorisation configuration: ${missing.join(", ")}`);
  return { appId: env.GITHUB_APP_ID!, clientId: env.GITHUB_APP_CLIENT_ID!, clientSecret: env.GITHUB_APP_CLIENT_SECRET!, privateKey: env.GITHUB_APP_PRIVATE_KEY!, owner: env.GITHUB_ARTIFACT_REPOSITORY_OWNER!, repo: env.GITHUB_ARTIFACT_REPOSITORY_NAME!, branch: env.GITHUB_ARTIFACT_REPOSITORY_BRANCH ?? "main", rootPath: env.GITHUB_ARTIFACT_REPOSITORY_ROOT ?? "artifacts", allowedLogins: parseAllowedGitHubLogins() };
}

function classify(error: unknown): RepositoryAuthorizationFailureReason {
  const status = (error as { status?: number }).status;
  if (status === 401 || status === 403 || status === 404) return "app_access";
  if (status === 429 || (typeof status === "number" && status >= 500) || !status) return "temporary_unavailable";
  return "configuration";
}

export async function verifyRepositoryAuthorization(user: { id: number; login: string }, userAccessToken: string, config = getRepositoryAuthorizationConfig(), fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<RepositoryAuthorizationStatus> {
  const login = user.login.toLowerCase();
  if (config.allowedLogins.length > 0 && !config.allowedLogins.includes(login)) return { ok: false, reason: "allowlist", message: repositoryAccessDeniedMessages.allowlist };

  try {
    let repo;
    try { repo = await getConfiguredRepository(config, userAccessToken, fetchImpl); } catch (error) { const status = (error as { status?: number }).status; if (status === 401 || status === 403 || status === 404) return { ok: false, reason: "user_access", message: repositoryAccessDeniedMessages.user_access }; throw error; }
    if (repo.name.toLowerCase() !== config.repo.toLowerCase() || repo.owner.login.toLowerCase() !== config.owner.toLowerCase()) return { ok: false, reason: "user_access", message: repositoryAccessDeniedMessages.user_access };
    const appJwt = await createGitHubAppJwt(config.appId, config.privateKey);
    const installation = await getRepositoryInstallation(config, appJwt, fetchImpl);
    let tokenPromise: Promise<string> | undefined;
    const provider = () => tokenPromise ??= (async () => {
      const minted = await mintInstallationToken(installation.id, repo.id, await createGitHubAppJwt(config.appId, config.privateKey), fetchImpl);
      if (!minted.token) throw new Error("installation_token_unavailable");
      return minted.token;
    })();
    return { ok: true, owner: config.owner, repo: config.repo, login: user.login, githubId: user.id, repositoryId: repo.id, installationId: installation.id, checkedAt: now, installationTokenProvider: provider };
  } catch (error) {
    const reason = classify(error);
    return { ok: false, reason, message: repositoryAccessDeniedMessages[reason], temporary: reason === "temporary_unavailable" };
  }
}

export function createRepositoryAuthorizationRecord(status: Extract<RepositoryAuthorizationStatus, { ok: true }>, now = status.checkedAt) {
  return { state: "authorized" as const, owner: status.owner, repo: status.repo, login: status.login, githubId: status.githubId, repositoryId: status.repositoryId, installationId: status.installationId, checkedAt: now };
}

export function createDeniedAuthorizationRecord(sessionLike: { githubId: number; login: string }, reason: RepositoryAuthorizationFailureReason, config = getRepositoryAuthorizationConfig(), now = Date.now()) {
  return { state: "denied" as const, denialReason: reason, owner: config.owner, repo: config.repo, login: sessionLike.login, githubId: sessionLike.githubId, checkedAt: now };
}

export function storedAuthorizationMatchesConfig(session: SessionRecord, config = getRepositoryAuthorizationConfig()) {
  const auth = session.repositoryAuthorization;
  return auth.githubId === session.githubId && auth.login.toLowerCase() === session.login.toLowerCase() && auth.owner.toLowerCase() === config.owner.toLowerCase() && auth.repo.toLowerCase() === config.repo.toLowerCase();
}

export function authorizationDeniedResponse(reason: RepositoryAuthorizationFailureReason) {
  const status = reason === "temporary_unavailable" ? 503 : 403;
  return Response.json({ error: "Repository authorisation required", reason, message: repositoryAccessDeniedMessages[reason] }, { status, headers: noStoreHeaders });
}
