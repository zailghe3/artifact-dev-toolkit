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

import { findSession, insertSession, revokeSessionId, type D1DatabaseBinding } from "@/lib/auth-session-store";
import {
  authorizationDeniedResponse,
  createDeniedAuthorizationRecord,
  createRepositoryAuthorizationRecord,
  getRepositoryAuthorizationConfig,
  storedAuthorizationMatchesConfig,
  verifyRepositoryAuthorization,
  type RepositoryAuthorizationStatus,
} from "@/lib/repository-authorization";
import { createPkceChallenge } from "@/lib/github-app";

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

export function getAuthConfig() {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  const sessionSecret = process.env.SESSION_SECRET;
  const tokenEncryptionKey = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  const missing = [["GITHUB_APP_CLIENT_ID", clientId], ["GITHUB_APP_CLIENT_SECRET", clientSecret], ["SESSION_SECRET", sessionSecret], ["GITHUB_TOKEN_ENCRYPTION_KEY", tokenEncryptionKey]].filter(([, value]) => !value);
  if (missing.length) throw new Error(`Missing authentication configuration: ${missing.map(([name]) => name).join(", ")}`);
  if (sessionSecret!.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters long.");
  validateTokenEncryptionKey(tokenEncryptionKey!);
  return { clientId: clientId!, clientSecret: clientSecret!, sessionSecret: sessionSecret!, tokenEncryptionKey: tokenEncryptionKey! };
}

function decodeBase64Key(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function validateTokenEncryptionKey(value: string) {
  const bytes = decodeBase64Key(value);
  if (bytes.byteLength !== 32) throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY must be base64-encoded 32-byte AES-GCM key material.");
  return bytes;
}

async function importTokenEncryptionKey() {
  return crypto.subtle.importKey("raw", validateTokenEncryptionKey(getAuthConfig().tokenEncryptionKey), "AES-GCM", false, ["encrypt", "decrypt"]);
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
  const { clientId } = getAuthConfig();
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
  if (!tokenResponse.ok) throw new Error("github_exchange_failed");
  const tokenPayload = (await tokenResponse.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!tokenPayload.access_token) throw new Error("github_exchange_failed");
  const userTokenExpiresAt = Date.now() + Math.max(1, tokenPayload.expires_in ?? 28_800) * 1000;
  const userResponse = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${tokenPayload.access_token}`, accept: "application/vnd.github+json", "user-agent": "artifact-dev-toolkit" } });
  if (!userResponse.ok) throw new Error("github_identity_failed");
  const user = validateGitHubUser(await userResponse.json());
  const repositoryAuthorization = await verifyRepositoryAuthorization(user, tokenPayload.access_token, config);
  return { user, repositoryAuthorization, userAccessToken: tokenPayload.access_token, userTokenExpiresAt };
}


export async function createSession(user: GitHubUser, repositoryAuthorization: RepositoryAuthorizationStatus, userAccessToken?: string, userTokenExpiresAt = Date.now() + sessionTtlSeconds * 1000) {
  const config = getRepositoryAuthorizationConfig();
  const tokenFields = repositoryAuthorization.ok && userAccessToken ? await encryptUserAccessToken(userAccessToken) : {};
  const expiresAt = Math.min(Date.now() + sessionTtlSeconds * 1000, userTokenExpiresAt);
  const session: SessionRecord = { id: randomToken(48), githubId: user.id, login: user.login, name: user.name, avatarUrl: user.avatar_url, createdAt: Date.now(), expiresAt, repositoryAuthorization: repositoryAuthorization.ok ? createRepositoryAuthorizationRecord(repositoryAuthorization) as SessionRecord["repositoryAuthorization"] : createDeniedAuthorizationRecord({ githubId: user.id, login: user.login }, repositoryAuthorization.reason, config), userAccessTokenExpiresAt: repositoryAuthorization.ok ? userTokenExpiresAt : undefined, ...tokenFields };
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
  const session = await requireAuth(returnTo);
  if (!storedAuthorizationMatchesConfig(session)) redirect("/access-denied");
  if (session.repositoryAuthorization.state !== "authorized") redirect("/access-denied");
  return session;
}


export async function requireApiAuth(request: Request) {
  const session = await getSession();
  if (session?.repositoryAuthorization.state === "authorized" && storedAuthorizationMatchesConfig(session)) return undefined;
  if (session) return authorizationDeniedResponse(session.repositoryAuthorization.denialReason ?? "configuration");
  const signInUrl = new URL("/sign-in", request.url);
  const requestUrl = new URL(request.url);
  signInUrl.searchParams.set("returnTo", requestUrl.pathname + requestUrl.search);
  return NextResponse.json({ error: "Authentication required", signInUrl: signInUrl.toString() }, { status: 401, headers: noStoreHeaders });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const id = cookieStore.get(cookieNames().session)?.value;
  if (id) await revokeSession(id);
  cookieStore.delete(cookieNames().session);
}
