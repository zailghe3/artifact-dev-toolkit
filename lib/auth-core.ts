export const productionSessionCookieName = "__Host-adt_session";
export const productionStateCookieName = "__Host-adt_oauth_state";
export const productionReturnCookieName = "__Host-adt_oauth_return";
export const productionPkceCookieName = "__Host-adt_pkce_verifier";
export const developmentSessionCookieName = "adt_session";
export const developmentStateCookieName = "adt_oauth_state";
export const developmentReturnCookieName = "adt_oauth_return";
export const developmentPkceCookieName = "adt_pkce_verifier";
export const sessionCookieName = productionSessionCookieName;
export const stateCookieName = productionStateCookieName;
export const returnCookieName = productionReturnCookieName;
export const pkceCookieName = productionPkceCookieName;
export const sessionTtlSeconds = 60 * 60 * 8;
export const oauthStateTtlSeconds = 60 * 10;

export type AuthCookie = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

export type SessionRecord = {
  id: string;
  githubId: number;
  login: string;
  name?: string;
  avatarUrl?: string;
  expiresAt: number;
  createdAt?: number;
  revokedAt?: number;
  repositoryAuthorization: {
    state: "authorized" | "denied";
    denialReason?: "configuration" | "allowlist" | "app_access" | "user_access" | "temporary_unavailable";
    owner: string;
    repo: string;
    repositoryId?: number;
    installationId?: number;
    login: string;
    githubId: number;
    checkedAt: number;
  };
  encryptedUserAccessToken?: string;
  userAccessTokenExpiresAt?: number;
  tokenIv?: string;
};

export type GitHubUser = {
  id: number;
  login: string;
  name?: string;
  avatar_url?: string;
};

export type CookieNames = {
  session: string;
  state: string;
  returnTo: string;
  pkce: string;
};

export type OAuthErrorCode = "denied" | "invalid_state" | "missing_code" | "github_exchange_failed" | "github_identity_failed" | "session_creation_failed" | "configuration" | "oauth_start_failed";

export const oauthErrorMessages: Record<OAuthErrorCode, string> = {
  denied: "GitHub authorization was denied or cancelled.",
  invalid_state: "The sign-in request expired or could not be verified. Please try again.",
  missing_code: "GitHub did not return an authorization code. Please try again.",
  github_exchange_failed: "GitHub sign-in could not be completed. Please try again.",
  github_identity_failed: "GitHub identity could not be verified. Please try again.",
  session_creation_failed: "A server session could not be created. Please try again.",
  configuration: "Sign-in is temporarily unavailable because the service is not correctly configured. Please contact an administrator.",
  oauth_start_failed: "Sign-in is temporarily unavailable. Please try again later.",
};

export function cookieNames(nodeEnv = process.env.NODE_ENV): CookieNames {
  if (nodeEnv === "production") {
    return { session: productionSessionCookieName, state: productionStateCookieName, returnTo: productionReturnCookieName, pkce: productionPkceCookieName };
  }
  return { session: developmentSessionCookieName, state: developmentStateCookieName, returnTo: developmentReturnCookieName, pkce: developmentPkceCookieName };
}

export function cookieOptions(maxAge: number, nodeEnv = process.env.NODE_ENV): AuthCookie {
  return { httpOnly: true, secure: nodeEnv === "production", sameSite: "lax", path: "/", maxAge };
}

export const noStoreHeaders = { "cache-control": "private, no-store, max-age=0" } as const;

const hexToken = (value: unknown, length: number): value is string =>
  typeof value === "string" && value.length === length && !/[^0-9a-f]/.test(value);
export const isSessionId = (value: unknown): value is string => hexToken(value, 96);
export const isOAuthState = (value: unknown): value is string => hexToken(value, 64);
export const isPkceVerifier = (value: unknown): value is string => hexToken(value, 96);

export function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(left: string | undefined | null, right: string | undefined | null) {
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

const returnToOrigin = "https://artifact-dev-toolkit.local";
const unsafePath = (path: string) => !path.startsWith("/") || path.startsWith("//") || /[\\\p{Cc}]/u.test(path);
const authenticationPath = /^\/(?:auth|sign-in|sign-out|access-denied|api\/workflow-connections\/work-iq\/callback)(?:\/|$)/i;

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || unsafePath(value)) return "/";
  const parsed = URL.parse(value, returnToOrigin);
  if (!parsed || parsed.origin !== returnToOrigin || unsafePath(parsed.pathname)) return "/";

  // Check decoded forms of the path for routing ambiguities. Keep the browser's
  // original escaping in the returned query, fragment, and path.
  let path = parsed.pathname;
  const destination = `${path}${parsed.search}${parsed.hash}`;
  if (encodeURIComponent(destination).length > 3000) return "/";
  for (let depth = 0; depth < 5; depth++) {
    if (unsafePath(path) || /%2f/i.test(path)) return "/";
    const normalized = new URL(path.replaceAll("?", "%3F").replaceAll("#", "%23"), returnToOrigin).pathname;
    if (unsafePath(normalized) || authenticationPath.test(normalized)) return "/";
    if (!/%[0-9a-f]{2}/i.test(path)) return destination;
    try { path = decodeURIComponent(path); } catch { return "/"; }
  }
  return "/";
}

export function validateGitHubUser(value: unknown): GitHubUser {
  if (!value || typeof value !== "object") throw new Error("github_identity_failed");
  const user = value as Record<string, unknown>;
  const githubId = user.id;
  const login = user.login;
  if (typeof githubId !== "number" || !Number.isSafeInteger(githubId) || typeof login !== "string" || login.length === 0) {
    throw new Error("github_identity_failed");
  }
  const validated: GitHubUser = { id: githubId, login };
  if (typeof user.name === "string" && user.name.length > 0) validated.name = user.name;
  if (typeof user.avatar_url === "string" && user.avatar_url.length > 0) validated.avatar_url = user.avatar_url;
  return validated;
}

export function serializeSession(session: SessionRecord) {
  return JSON.stringify(session);
}

export function parseSession(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<SessionRecord>;
    if (typeof parsed.id !== "string" || parsed.id.length === 0) return undefined;
    if (!Number.isSafeInteger(parsed.githubId)) return undefined;
    if (typeof parsed.login !== "string" || parsed.login.length === 0) return undefined;
    if (typeof parsed.expiresAt !== "number" || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now) return undefined;
    const authorization = parsed.repositoryAuthorization as Record<string, unknown> | undefined;
    if (!authorization || typeof authorization !== "object") return undefined;
    if (typeof authorization.owner !== "string" || authorization.owner.length === 0) return undefined;
    if (typeof authorization.repo !== "string" || authorization.repo.length === 0) return undefined;
    if (typeof authorization.login !== "string" || authorization.login.length === 0) return undefined;
    if (authorization.state !== "authorized" && authorization.state !== "denied") return undefined;
    if (!Number.isSafeInteger(authorization.githubId)) return undefined;
    if (typeof authorization.checkedAt !== "number" || !Number.isFinite(authorization.checkedAt)) return undefined;
    return parsed as SessionRecord;
  } catch {
    return undefined;
  }
}
