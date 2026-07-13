import { parseSession, serializeSession, type SessionRecord } from "./auth-core.ts";

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  run(): Promise<unknown>;
};

export type D1DatabaseBinding = {
  prepare(query: string): D1PreparedStatement;
};

export async function hashSessionId(id: string, sessionSecret: string) {
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

export async function insertSession(database: D1DatabaseBinding, sessionSecret: string, session: SessionRecord, now = Date.now()) {
  const storedId = await hashSessionId(session.id, sessionSecret);
  await database
    .prepare("INSERT INTO auth_sessions (id, github_id, login, name, avatar_url, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)")
    .bind(storedId, session.githubId, session.login, session.name ?? null, session.avatarUrl ?? null, session.expiresAt, now)
    .run();
  return storedId;
}

export async function findSession(database: D1DatabaseBinding, sessionSecret: string, id: string, now = Date.now()) {
  const storedId = await hashSessionId(id, sessionSecret);
  const row = await database
    .prepare("SELECT id, github_id, login, name, avatar_url, expires_at, revoked_at FROM auth_sessions WHERE id = ?")
    .bind(storedId)
    .first<{ id: string; github_id: number; login: string; name: string | null; avatar_url: string | null; expires_at: number; revoked_at: number | null }>();

  if (!row || row.revoked_at !== null || row.expires_at <= now) return undefined;
  return parseSession(
    serializeSession({
      id,
      githubId: row.github_id,
      login: row.login,
      name: row.name ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
      expiresAt: row.expires_at,
    }),
    now,
  );
}

export async function revokeSessionId(database: D1DatabaseBinding, sessionSecret: string, id: string, now = Date.now()) {
  const storedId = await hashSessionId(id, sessionSecret);
  await database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, storedId).run();
  return storedId;
}
