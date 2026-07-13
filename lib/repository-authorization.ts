import { noStoreHeaders, type GitHubUser } from "./auth-core.ts";

const githubApiBaseUrl = "https://api.github.com";

export type RepositoryAuthorizationConfig = {
  owner: string;
  repo: string;
  appToken: string;
  allowedLogins: string[];
};

export type RepositoryAuthorizationStatus =
  | { ok: true; owner: string; repo: string; login: string }
  | { ok: false; reason: RepositoryAuthorizationFailureReason; message: string };

export type RepositoryAuthorizationFailureReason = "configuration" | "allowlist" | "app_access" | "user_access";

export type RepositoryAuthorizationRecord = {
  owner: string;
  repo: string;
  login: string;
  checkedAt: number;
};

export const repositoryAccessDeniedMessages: Record<RepositoryAuthorizationFailureReason, string> = {
  configuration: "Artifact repository access is not configured. Contact an administrator.",
  allowlist: "Your GitHub account is not on the artifact library allowlist.",
  app_access: "The GitHub App is not installed with access to the configured artifact repository.",
  user_access: "Your GitHub account is not authorised for the configured artifact repository.",
};

export function parseAllowedGitHubLogins(value = process.env.GITHUB_ARTIFACT_ALLOWED_LOGINS ?? "") {
  return value
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean);
}

export function getRepositoryAuthorizationConfig(): RepositoryAuthorizationConfig {
  const owner = process.env.GITHUB_ARTIFACT_REPOSITORY_OWNER;
  const repo = process.env.GITHUB_ARTIFACT_REPOSITORY_NAME;
  const appToken = process.env.GITHUB_ARTIFACT_REPOSITORY_TOKEN;
  const missing = [
    ["GITHUB_ARTIFACT_REPOSITORY_OWNER", owner],
    ["GITHUB_ARTIFACT_REPOSITORY_NAME", repo],
    ["GITHUB_ARTIFACT_REPOSITORY_TOKEN", appToken],
  ].filter(([, value]) => !value);

  if (missing.length) {
    throw new Error(`Missing repository authorisation configuration: ${missing.map(([name]) => name).join(", ")}`);
  }

  return { owner: owner!, repo: repo!, appToken: appToken!, allowedLogins: parseAllowedGitHubLogins() };
}

function githubRepositoryUrl(owner: string, repo: string) {
  return `${githubApiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function canReadRepository(owner: string, repo: string, token: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(githubRepositoryUrl(owner, repo), {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "artifact-dev-toolkit",
      "x-github-api-version": "2022-11-28",
    },
  });
  return response.ok;
}

export async function verifyRepositoryAuthorization(
  user: GitHubUser,
  userAccessToken: string,
  config: RepositoryAuthorizationConfig = getRepositoryAuthorizationConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<RepositoryAuthorizationStatus> {
  const login = user.login.toLowerCase();
  if (config.allowedLogins.length > 0 && !config.allowedLogins.includes(login)) {
    return { ok: false, reason: "allowlist", message: repositoryAccessDeniedMessages.allowlist };
  }

  const appCanRead = await canReadRepository(config.owner, config.repo, config.appToken, fetchImpl);
  if (!appCanRead) return { ok: false, reason: "app_access", message: repositoryAccessDeniedMessages.app_access };

  const userCanRead = await canReadRepository(config.owner, config.repo, userAccessToken, fetchImpl);
  if (!userCanRead) return { ok: false, reason: "user_access", message: repositoryAccessDeniedMessages.user_access };

  return { ok: true, owner: config.owner, repo: config.repo, login: user.login };
}

export function createRepositoryAuthorizationRecord(status: Extract<RepositoryAuthorizationStatus, { ok: true }>, now = Date.now()): RepositoryAuthorizationRecord {
  return { owner: status.owner, repo: status.repo, login: status.login, checkedAt: now };
}

export function authorizationDeniedResponse(reason: RepositoryAuthorizationFailureReason) {
  return Response.json({ error: "Repository authorisation required", reason, message: repositoryAccessDeniedMessages[reason] }, { status: 403, headers: noStoreHeaders });
}
