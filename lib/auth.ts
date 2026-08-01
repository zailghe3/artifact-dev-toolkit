import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import {
  constantTimeEqual,
  cookieNames,
  cookieOptions,
  noStoreHeaders,
  oauthStateTtlSeconds,
  randomToken,
  safeReturnTo,
  sessionTtlSeconds,
  validateGitHubUser,
  type GitHubUser,
  type SessionRecord,
} from "@/lib/auth-core";

import { findSession, insertSession, revokeSessionId, updateSessionAuthorization, type D1DatabaseBinding } from "@/lib/auth-session-store";
import {
  authorizationDeniedResponse,
  authorizationRequiresRevalidation,
  createDeniedAuthorizationRecord,
  createRepositoryAuthorizationRecord,
  getRepositoryAuthorizationConfig,
  storedAuthorizationMatchesConfig,
  shouldRetainUserToken,
  verifyRepositoryAuthorization,
  type RepositoryAccessContext,
  type RepositoryAuthorizationStatus,
} from "@/lib/repository-authorization";
import { createPkceChallenge } from "@/lib/github-app";
import { getOAuthExchangeConfig, getSessionSecurityConfig, validateProductionAuthReadiness, validateTokenEncryptionKey } from "@/lib/auth-configuration";

let testSessionDatabase: D1DatabaseBinding | undefined;

export function setTestSessionDatabase(database: D1DatabaseBinding | undefined) {
  testSessionDatabase = database;
}

async function getSessionDatabase() {
  if (testSessionDatabase) return testSessionDatabase;
  const { env } = await getCloudflareContext({ async: true });
  const database = (env as CloudflareEnv & { AUTH_SESSIONS_DB?: D1DatabaseBinding }).AUTH_SESSIONS_DB;
  if (!database) throw new Error("Missing Cloudflare D1 binding: AUTH_SESSIONS_DB");
  return database;
}

async function storeSession(session: SessionRecord) {
  const database = await getSessionDatabase();
  await insertSession(database, getAuthConfig().sessionSecret, session);
}

async function loadSession(id: string) {
  const database = await getSessionDatabase();
  return findSession(database, getAuthConfig().sessionSecret, id);
}

async function revokeSession(id: string) {
  const database = await getSessionDatabase();
  await revokeSessionId(database, getAuthConfig().sessionSecret, id);
}

async function persistAuthorization(session: SessionRecord) {
  const database = await getSessionDatabase();
  await updateSessionAuthorization(database, getAuthConfig().sessionSecret, session);
}

export function getAuthConfig() {
  return { ...getOAuthExchangeConfig(), ...getSessionSecurityConfig() };
}

export { validateTokenEncryptionKey } from "@/lib/auth-configuration";

async function importTokenEncryptionKey() {
  const bytes = validateTokenEncryptionKey(getAuthConfig().tokenEncryptionKey);
  return crypto.subtle.importKey("raw", bytes.buffer as ArrayBuffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptUserAccessToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importTokenEncryptionKey(), new TextEncoder().encode(token));
  return { encryptedUserAccessToken: btoa(String.fromCharCode(...new Uint8Array(encrypted))), tokenIv: btoa(String.fromCharCode(...iv)) };
}

export async function decryptUserAccessToken(session: SessionRecord) {
  if (!session.encryptedUserAccessToken || !session.tokenIv) throw new Error("missing_user_token");
  const data = Uint8Array.from(atob(session.encryptedUserAccessToken), (char) => char.charCodeAt(0));
  const iv = Uint8Array.from(atob(session.tokenIv), (char) => char.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await importTokenEncryptionKey(), data);
  return new TextDecoder().decode(plain);
}


export async function createOAuthStart(returnTo: string | null) {
  const { clientId } = await validateProductionAuthReadiness();
  const state = randomToken();
  const verifier = randomToken(48);
  const challenge = await createPkceChallenge(verifier);
  const cookieStore = await cookies();
  const names = cookieNames();
  cookieStore.set(names.state, state, cookieOptions(oauthStateTtlSeconds));
  cookieStore.set(names.returnTo, safeReturnTo(returnTo), cookieOptions(oauthStateTtlSeconds));
  cookieStore.set(names.pkce, verifier, cookieOptions(oauthStateTtlSeconds));
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  return authorizeUrl;
}


export async function consumeOAuthState(state: string | null) {
  const cookieStore = await cookies();
  const names = cookieNames();
  const expected = cookieStore.get(names.state)?.value;
  const returnTo = safeReturnTo(cookieStore.get(names.returnTo)?.value ?? null);
  cookieStore.delete(names.state);
  const pkceVerifier = cookieStore.get(names.pkce)?.value;
  cookieStore.delete(names.returnTo);
  cookieStore.delete(names.pkce);
  return { valid: constantTimeEqual(state, expected) && Boolean(pkceVerifier), returnTo, pkceVerifier };
}

export async function exchangeGitHubCode(code: string, pkceVerifier: string) {
  const { clientId, clientSecret } = getAuthConfig();
  const config = getRepositoryAuthorizationConfig();
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, code_verifier: pkceVerifier }) });
  if (!tokenResponse.ok) throw Object.assign(new Error("oauth_flow_failed"), { category: "token_exchange" });
  const tokenPayload = (await tokenResponse.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!tokenPayload.access_token) throw Object.assign(new Error("oauth_flow_failed"), { category: "token_exchange" });
  const userTokenExpiresAt = Date.now() + Math.max(1, tokenPayload.expires_in ?? 28_800) * 1000;
  const userResponse = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${tokenPayload.access_token}`, accept: "application/vnd.github+json", "user-agent": "artifact-dev-toolkit" } });
  if (!userResponse.ok) throw Object.assign(new Error("oauth_flow_failed"), { category: "identity_lookup" });
  let user: GitHubUser;
  try { user = validateGitHubUser(await userResponse.json()); } catch { throw Object.assign(new Error("oauth_flow_failed"), { category: "identity_lookup" }); }
  const repositoryAuthorization = await verifyRepositoryAuthorization(user, tokenPayload.access_token, config);
  return { user, repositoryAuthorization, userAccessToken: tokenPayload.access_token, userTokenExpiresAt };
}


export async function createSession(user: GitHubUser, repositoryAuthorization: RepositoryAuthorizationStatus, userAccessToken?: string, userTokenExpiresAt = Date.now() + sessionTtlSeconds * 1000) {
  const config = getRepositoryAuthorizationConfig();
  const retainUserToken = shouldRetainUserToken(repositoryAuthorization);
  const tokenFields = retainUserToken && userAccessToken ? await encryptUserAccessToken(userAccessToken) : {};
  const expiresAt = Math.min(Date.now() + sessionTtlSeconds * 1000, userTokenExpiresAt);
  const session: SessionRecord = { id: randomToken(48), githubId: user.id, login: user.login, name: user.name, avatarUrl: user.avatar_url, createdAt: Date.now(), expiresAt, repositoryAuthorization: repositoryAuthorization.ok ? createRepositoryAuthorizationRecord(repositoryAuthorization) as SessionRecord["repositoryAuthorization"] : createDeniedAuthorizationRecord({ githubId: user.id, login: user.login }, repositoryAuthorization.reason, config), userAccessTokenExpiresAt: retainUserToken ? userTokenExpiresAt : undefined, ...tokenFields };
  await storeSession(session);
  const cookieStore = await cookies();
  cookieStore.set(cookieNames().session, session.id, cookieOptions(Math.floor((expiresAt - Date.now()) / 1000)));
  return session;
}


export async function getSession() {
  const cookieStore = await cookies();
  const id = cookieStore.get(cookieNames().session)?.value;
  if (!id) return undefined;
  const session = await loadSession(id);
  if (!session) return undefined;
  return session;
}

export async function requireAuth(returnTo = "/") {
  const session = await getSession();
  if (!session) redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  return session;
}

export async function requireRepositoryAuthorization(returnTo = "/") {
  return (await requireRepositoryAccess(returnTo)).session;
}

async function resolveRepositoryAccess(session: SessionRecord, now = Date.now()): Promise<{ session: SessionRecord; access?: RepositoryAccessContext; failure?: RepositoryAuthorizationStatus & { ok: false }; reauthenticate?: boolean; refreshed: boolean }> {
  const config = getRepositoryAuthorizationConfig();
  const auth = session.repositoryAuthorization;
  const matches = storedAuthorizationMatchesConfig(session, config);
  const stale = authorizationRequiresRevalidation(auth, now);
  if (!matches) {
    const failure = { ok: false as const, reason: "configuration" as const, message: "Repository access is not authorised." };
    try {
      session.repositoryAuthorization = createDeniedAuthorizationRecord(session, "configuration", config, now);
      await persistAuthorization(session);
    } catch { return { session, failure: { ok: false, reason: "temporary_unavailable", message: "Repository authorisation is temporarily unavailable." }, refreshed: false }; }
    return { session, failure, refreshed: false };
  }
  if (!stale && (auth.state !== "authorized" || !Number.isSafeInteger(auth.repositoryId) || !Number.isSafeInteger(auth.installationId))) {
    return { session, failure: { ok: false, reason: auth.denialReason ?? "configuration", message: "Repository access is not authorised." }, refreshed: false };
  }
  let status: RepositoryAuthorizationStatus;
  let refreshed = false;
  if (stale) {
    if (!session.encryptedUserAccessToken || !session.tokenIv || !session.userAccessTokenExpiresAt || session.userAccessTokenExpiresAt <= now) {
      await revokeSession(session.id);
      return { session, reauthenticate: true, refreshed: false };
    }
    let token: string;
    try { token = await decryptUserAccessToken(session); } catch { await revokeSession(session.id); return { session, reauthenticate: true, refreshed: false }; }
    status = await verifyRepositoryAuthorization({ id: session.githubId, login: session.login }, token, config, fetch, now);
    refreshed = true;
    session.repositoryAuthorization = status.ok ? createRepositoryAuthorizationRecord(status, now) : createDeniedAuthorizationRecord(session, status.reason, config, now);
    try { await persistAuthorization(session); } catch { return { session, failure: { ok: false, reason: "temporary_unavailable", message: "Repository authorisation is temporarily unavailable." }, refreshed }; }
    console.info(JSON.stringify({ event: "repository_authorization_refreshed", owner: config.owner, repository: config.repo, authorizationState: session.repositoryAuthorization.state, refreshed: true, reason: status.ok ? undefined : status.reason }));
    if (!status.ok) return { session, failure: status, refreshed };
  } else {
    let tokenPromise: Promise<string> | undefined;
    status = { ok: true, owner: auth.owner, repo: auth.repo, login: session.login.toLowerCase(), githubId: session.githubId, repositoryId: auth.repositoryId!, installationId: auth.installationId!, checkedAt: auth.checkedAt, installationTokenProvider: () => tokenPromise ??= (async () => {
      const appJwt = await import("@/lib/github-app").then(({ createGitHubAppJwt }) => createGitHubAppJwt(config.appId, config.privateKey));
      const minted = await import("@/lib/github-app").then(({ mintInstallationToken }) => mintInstallationToken(auth.installationId!, auth.repositoryId!, appJwt));
      if (!minted.token) throw new Error("installation_token_unavailable");
      return minted.token;
    })() };
  }
  return { session, access: status as RepositoryAccessContext, refreshed };
}

export async function requireRepositoryAccess(returnTo = "/") {
  const session = await requireAuth(returnTo);
  const result = await resolveRepositoryAccess(session);
  if (result.reauthenticate) redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  if (!result.access) redirect("/access-denied");
  return { session: result.session, access: result.access };
}

export async function requireApiRepositoryAccess(request: Request): Promise<{ access: RepositoryAccessContext; session: SessionRecord } | Response> {
  const session = await getSession();
  if (session) {
    const result = await resolveRepositoryAccess(session);
    if (result.access) return { access: result.access, session: result.session };
    if (!result.reauthenticate) return authorizationDeniedResponse(result.failure?.reason ?? "configuration");
  }
  const signInUrl = new URL("/sign-in", request.url);
  const requestUrl = new URL(request.url);
  signInUrl.searchParams.set("returnTo", requestUrl.pathname + requestUrl.search);
  return NextResponse.json({ error: "Authentication required", signInUrl: signInUrl.toString() }, { status: 401, headers: noStoreHeaders });
}

export async function requireApiAuth(request: Request) {
  const result = await requireApiRepositoryAccess(request);
  return result instanceof Response ? result : undefined;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const id = cookieStore.get(cookieNames().session)?.value;
  if (id) await revokeSession(id);
  cookieStore.delete(cookieNames().session);
}
