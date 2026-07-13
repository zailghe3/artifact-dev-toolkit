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
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const sessionSecret = process.env.SESSION_SECRET;
  const missing = [
    ["GITHUB_OAUTH_CLIENT_ID", clientId],
    ["GITHUB_OAUTH_CLIENT_SECRET", clientSecret],
    ["SESSION_SECRET", sessionSecret],
  ].filter(([, value]) => !value);

  if (missing.length) {
    throw new Error(`Missing authentication configuration: ${missing.map(([name]) => name).join(", ")}`);
  }

  if (sessionSecret!.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters long.");
  }

  return { clientId: clientId!, clientSecret: clientSecret!, sessionSecret: sessionSecret! };
}

export async function createOAuthStart(returnTo: string | null) {
  const { clientId } = getAuthConfig();
  const state = randomToken();
  const cookieStore = await cookies();
  const names = cookieNames();
  cookieStore.set(names.state, state, cookieOptions(oauthStateTtlSeconds));
  cookieStore.set(names.returnTo, safeReturnTo(returnTo), cookieOptions(oauthStateTtlSeconds));

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("state", state);
  return authorizeUrl;
}

export async function consumeOAuthState(state: string | null) {
  const cookieStore = await cookies();
  const names = cookieNames();
  const expected = cookieStore.get(names.state)?.value;
  const returnTo = safeReturnTo(cookieStore.get(names.returnTo)?.value ?? null);
  cookieStore.delete(names.state);
  cookieStore.delete(names.returnTo);
  return { valid: constantTimeEqual(state, expected), returnTo };
}

export async function exchangeGitHubCode(code: string) {
  const { clientId, clientSecret } = getAuthConfig();
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!tokenResponse.ok) throw new Error("github_exchange_failed");
  const tokenPayload = (await tokenResponse.json()) as { access_token?: string; error_description?: string };
  if (!tokenPayload.access_token) throw new Error("github_exchange_failed");

  const userResponse = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${tokenPayload.access_token}`, accept: "application/vnd.github+json", "user-agent": "artifact-dev-toolkit" },
  });
  if (!userResponse.ok) throw new Error("github_identity_failed");
  return validateGitHubUser(await userResponse.json());
}

export async function createSession(user: GitHubUser) {
  const session: SessionRecord = {
    id: randomToken(48),
    githubId: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    expiresAt: Date.now() + sessionTtlSeconds * 1000,
  };
  await storeSession(session);
  const cookieStore = await cookies();
  cookieStore.set(cookieNames().session, session.id, cookieOptions(sessionTtlSeconds));
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

export async function requireApiAuth(request: Request) {
  const session = await getSession();
  if (session) return undefined;
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
