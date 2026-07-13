export const productionSessionCookieName = "__Host-adt_session";
export const productionStateCookieName = "__Host-adt_oauth_state";
export const productionReturnCookieName = "__Host-adt_oauth_return";
export const developmentSessionCookieName = "adt_session";
export const developmentStateCookieName = "adt_oauth_state";
export const developmentReturnCookieName = "adt_oauth_return";
export const sessionCookieName = productionSessionCookieName;
export const stateCookieName = productionStateCookieName;
export const returnCookieName = productionReturnCookieName;
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
};

export type OAuthErrorCode = "denied" | "invalid_state" | "missing_code" | "github_exchange_failed" | "github_identity_failed" | "session_creation_failed";

export const oauthErrorMessages: Record<OAuthErrorCode, string> = {
  denied: "GitHub authorization was denied or cancelled.",
  invalid_state: "The sign-in request expired or could not be verified. Please try again.",
  missing_code: "GitHub did not return an authorization code. Please try again.",
  github_exchange_failed: "GitHub sign-in could not be completed. Please try again.",
  github_identity_failed: "GitHub identity could not be verified. Please try again.",
  session_creation_failed: "A server session could not be created. Please try again.",
};

export function cookieNames(nodeEnv = process.env.NODE_ENV): CookieNames {
  if (nodeEnv === "production") {
    return { session: productionSessionCookieName, state: productionStateCookieName, returnTo: productionReturnCookieName };
  }
  return { session: developmentSessionCookieName, state: developmentStateCookieName, returnTo: developmentReturnCookieName };
}

export function cookieOptions(maxAge: number, nodeEnv = process.env.NODE_ENV): AuthCookie {
  return { httpOnly: true, secure: nodeEnv === "production", sameSite: "lax", path: "/", maxAge };
}

export const noStoreHeaders = { "cache-control": "private, no-store, max-age=0" } as const;

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

export function safeReturnTo(value: string | null | undefined) {
  if (!value) return "/";
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "/";
  }

  if (!decoded.startsWith("/") || decoded.startsWith("//")) return "/";
  if (decoded.includes("\\") || decoded.includes("\u0000")) return "/";
  if (decoded.startsWith("/auth/") || decoded.startsWith("/sign-in")) return "/";

  try {
    const parsed = new URL(decoded, "https://artifact-dev-toolkit.local");
    if (parsed.origin !== "https://artifact-dev-toolkit.local") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
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
    return parsed as SessionRecord;
  } catch {
    return undefined;
  }
}
