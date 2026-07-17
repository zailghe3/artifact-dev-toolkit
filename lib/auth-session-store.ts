import { parseSession, serializeSession, type SessionRecord } from "./auth-core.ts";

export type D1RunResult = { meta?: { changes?: number } };
export type D1PreparedStatement = { bind(...values: unknown[]): D1PreparedStatement; first<T = unknown>(column?: string): Promise<T | null>; run(): Promise<D1RunResult> };
export type D1DatabaseBinding = { prepare(query: string): D1PreparedStatement };

export async function hashSessionId(id: string, sessionSecret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(sessionSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rowToSession(id: string, row: Record<string, unknown>, now = Date.now()): SessionRecord | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = row as Record<string, any>;
  return parseSession(serializeSession({
    id,
    githubId: r.github_id,
    login: r.login,
    name: r.name ?? undefined,
    avatarUrl: r.avatar_url ?? undefined,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at ?? undefined,
    repositoryAuthorization: {
      state: r.authorization_state,
      denialReason: r.denial_reason ?? undefined,
      owner: r.repository_owner,
      repo: r.repository_name,
      repositoryId: r.repository_id ?? undefined,
      installationId: r.installation_id ?? undefined,
      login: r.login,
      githubId: r.github_id,
      checkedAt: r.authorization_checked_at,
    },
    encryptedUserAccessToken: r.encrypted_user_access_token ?? undefined,
    userAccessTokenExpiresAt: r.user_access_token_expires_at ?? undefined,
    tokenIv: r.token_iv ?? undefined,
  }), now);
}

export async function insertSession(database: D1DatabaseBinding, sessionSecret: string, session: SessionRecord, now = Date.now()) {
  const storedId = await hashSessionId(session.id, sessionSecret);
  const auth = session.repositoryAuthorization;
  await database.prepare(`INSERT INTO auth_sessions (id, github_id, login, name, avatar_url, expires_at, created_at, revoked_at, authorization_state, denial_reason, repository_owner, repository_name, repository_id, installation_id, authorization_checked_at, encrypted_user_access_token, user_access_token_expires_at, token_iv) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(storedId, session.githubId, session.login, session.name ?? null, session.avatarUrl ?? null, session.expiresAt, session.createdAt ?? now, auth.state, auth.denialReason ?? null, auth.owner, auth.repo, auth.repositoryId ?? null, auth.installationId ?? null, auth.checkedAt, session.encryptedUserAccessToken ?? null, session.userAccessTokenExpiresAt ?? null, session.tokenIv ?? null)
    .run();
  return storedId;
}

export async function updateSessionAuthorization(database: D1DatabaseBinding, sessionSecret: string, session: SessionRecord) {
  const storedId = await hashSessionId(session.id, sessionSecret);
  const auth = session.repositoryAuthorization;
  const result = await database.prepare(`UPDATE auth_sessions SET authorization_state = ?, denial_reason = ?, repository_owner = ?, repository_name = ?, repository_id = ?, installation_id = ?, authorization_checked_at = ?, encrypted_user_access_token = ?, user_access_token_expires_at = ?, token_iv = ? WHERE id = ? AND revoked_at IS NULL`)
    .bind(auth.state, auth.denialReason ?? null, auth.owner, auth.repo, auth.repositoryId ?? null, auth.installationId ?? null, auth.checkedAt, session.encryptedUserAccessToken ?? null, session.userAccessTokenExpiresAt ?? null, session.tokenIv ?? null, storedId)
    .run();
  if (result.meta?.changes !== 1) throw new Error("active_session_update_failed");
}

export async function findSession(database: D1DatabaseBinding, sessionSecret: string, id: string, now = Date.now()) {
  const storedId = await hashSessionId(id, sessionSecret);
  const row = await database.prepare("SELECT * FROM auth_sessions WHERE id = ?").bind(storedId).first<Record<string, unknown>>();
  if (!row || row.revoked_at !== null || Number(row.expires_at) <= now) return undefined;
  return rowToSession(id, row, now);
}

export async function revokeSessionId(database: D1DatabaseBinding, sessionSecret: string, id: string, now = Date.now()) {
  const storedId = await hashSessionId(id, sessionSecret);
  await database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, storedId).run();
  return storedId;
}
