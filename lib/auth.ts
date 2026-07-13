import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import {
  constantTimeEqual,
  cookieOptions,
  noStoreHeaders,
  oauthStateTtlSeconds,
  parseSession,
  randomToken,
  returnCookieName,
  safeReturnTo,
  serializeSession,
  sessionCookieName,
  sessionTtlSeconds,
  stateCookieName,
  validateGitHubUser,
  type GitHubUser,
  type SessionRecord,
} from "@/lib/auth-core";

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  run(): Promise<unknown>;
};

type D1DatabaseBinding = {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<unknown>;
};

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

async function ensureSessionSchema(database: D1DatabaseBinding) {
  await database.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    github_id INTEGER NOT NULL,
    login TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`);
}

async function hashSessionId(id: string) {
  const { sessionSecret } = getAuthConfig();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function storeSession(session: SessionRecord) {
  const database = await getSessionDatabase();
  const storedId = await hashSessionId(session.id);
  await ensureSessionSchema(database);
  await database
    .prepare("INSERT INTO auth_sessions (id, github_id, login, name, avatar_url, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)")
    .bind(storedId, session.githubId, session.login, session.name ?? null, session.avatarUrl ?? null, session.expiresAt, Date.now())
    .run();
}

async function loadSession(id: string) {
  const database = await getSessionDatabase();
  const storedId = await hashSessionId(id);
  await ensureSessionSchema(database);
  const row = await database
    .prepare("SELECT id, github_id, login, name, avatar_url, expires_at, revoked_at FROM auth_sessions WHERE id = ?")
    .bind(storedId)
    .first<{ id: string; github_id: number; login: string; name: string | null; avatar_url: string | null; expires_at: number; revoked_at: number | null }>();

  if (!row || row.revoked_at !== null || row.expires_at <= Date.now()) return undefined;
  return parseSession(
    serializeSession({
      id,
      githubId: row.github_id,
      login: row.login,
      name: row.name ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
      expiresAt: row.expires_at,
    }),
  );
}

async function revokeSession(id: string) {
  const database = await getSessionDatabase();
  const storedId = await hashSessionId(id);
  await ensureSessionSchema(database);
  await database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Date.now(), storedId).run();
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
  cookieStore.set(stateCookieName, state, cookieOptions(oauthStateTtlSeconds));
  cookieStore.set(returnCookieName, safeReturnTo(returnTo), cookieOptions(oauthStateTtlSeconds));

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", "read:user");
  return authorizeUrl;
}

export async function consumeOAuthState(state: string | null) {
  const cookieStore = await cookies();
  const expected = cookieStore.get(stateCookieName)?.value;
  const returnTo = safeReturnTo(cookieStore.get(returnCookieName)?.value ?? null);
  cookieStore.delete(stateCookieName);
  cookieStore.delete(returnCookieName);
  return { valid: constantTimeEqual(state, expected), returnTo };
}

export async function exchangeGitHubCode(code: string) {
  const { clientId, clientSecret } = getAuthConfig();
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!tokenResponse.ok) throw new Error("GitHub token exchange failed.");
  const tokenPayload = (await tokenResponse.json()) as { access_token?: string; error_description?: string };
  if (!tokenPayload.access_token) throw new Error(tokenPayload.error_description ?? "GitHub did not return an access token.");

  const userResponse = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${tokenPayload.access_token}`, accept: "application/vnd.github+json", "user-agent": "artifact-dev-toolkit" },
  });
  if (!userResponse.ok) throw new Error("GitHub user lookup failed.");
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
  cookieStore.set(sessionCookieName, session.id, cookieOptions(sessionTtlSeconds));
  return session;
}

export async function getSession() {
  const cookieStore = await cookies();
  const id = cookieStore.get(sessionCookieName)?.value;
  if (!id) return undefined;
  const session = await loadSession(id);
  if (!session) {
    cookieStore.delete(sessionCookieName);
    return undefined;
  }
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
  const id = cookieStore.get(sessionCookieName)?.value;
  if (id) await revokeSession(id);
  cookieStore.delete(sessionCookieName);
}
