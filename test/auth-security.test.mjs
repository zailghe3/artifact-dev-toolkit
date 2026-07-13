import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(new URL("../lib/auth-core.ts", import.meta.url).pathname).href;
const {
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
} = await import(moduleUrl);

function consumeState(jar, incomingState) {
  const expected = jar.get(stateCookieName)?.value;
  const returnTo = safeReturnTo(jar.get(returnCookieName)?.value ?? null);
  jar.delete(stateCookieName);
  jar.delete(returnCookieName);
  return { valid: constantTimeEqual(incomingState, expected), returnTo };
}

test("OAuth state tokens use secure randomness and short-lived secure cookies", () => {
  const first = randomToken();
  const second = randomToken();
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.equal(oauthStateTtlSeconds, 600);
  assert.deepEqual(cookieOptions(oauthStateTtlSeconds, "production"), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: oauthStateTtlSeconds,
  });
  assert.deepEqual(cookieOptions(oauthStateTtlSeconds, "development"), {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: oauthStateTtlSeconds,
  });
  assert.equal(stateCookieName.startsWith("__Host-"), true);
  assert.equal(sessionCookieName.startsWith("__Host-"), true);
});

test("OAuth state validation accepts a matching state once and deletes callback cookies", () => {
  const state = randomToken();
  const jar = new Map([
    [stateCookieName, { value: state }],
    [returnCookieName, { value: "/artifacts/example?q=1" }],
  ]);

  assert.deepEqual(consumeState(jar, state), { valid: true, returnTo: "/artifacts/example?q=1" });
  assert.equal(jar.has(stateCookieName), false);
  assert.equal(jar.has(returnCookieName), false);
  assert.deepEqual(consumeState(jar, state), { valid: false, returnTo: "/" });
});

test("OAuth state validation rejects missing, mismatched, expired, and denied authorization states", () => {
  assert.equal(consumeState(new Map(), randomToken()).valid, false);
  assert.equal(consumeState(new Map([[stateCookieName, { value: randomToken() }]]), randomToken()).valid, false);
  assert.equal(consumeState(new Map([[stateCookieName, { value: randomToken() }]]), null).valid, false);

  const deniedJar = new Map([[stateCookieName, { value: "denied-state" }]]);
  assert.equal(consumeState(deniedJar, "different-state").valid, false);
  assert.equal(deniedJar.has(stateCookieName), false);
});

test("safe return URLs allow only application-local paths", () => {
  for (const value of ["/", "/artifacts/item", "/artifacts/item?q=one#section"]) {
    assert.equal(safeReturnTo(value), value);
  }

  for (const value of [
    null,
    "",
    "https://evil.example/path",
    "http://evil.example/path",
    "//evil.example/path",
    "%2f%2fevil.example/path",
    "/\\evil.example",
    "/%5Cevil.example",
    "javascript:alert(1)",
    "/auth/github/callback",
    "/sign-in?returnTo=/artifacts/item",
  ]) {
    assert.equal(safeReturnTo(value), "/", value ?? "null");
  }
});

test("GitHub identity validation requires a stable numeric id and login", () => {
  assert.deepEqual(validateGitHubUser({ id: 123, login: "octocat", name: "The Octocat", avatar_url: "https://example.test/a.png", extra: "ignored" }), {
    id: 123,
    login: "octocat",
    name: "The Octocat",
    avatar_url: "https://example.test/a.png",
  });

  for (const value of [{}, { id: "123", login: "octocat" }, { id: 123 }, { id: 123, login: "" }, null]) {
    assert.throws(() => validateGitHubUser(value), /github_identity_failed/);
  }
});

test("session parsing rejects missing, malformed, expired, revoked, and unknown session values", () => {
  const now = Date.UTC(2026, 6, 13);
  const session = { id: randomToken(48), githubId: 123, login: "octocat", expiresAt: now + 1000, repositoryAuthorization: { state: "authorized", owner: "owner", repo: "repo", login: "octocat", githubId: 123, repositoryId: 1, installationId: 2, checkedAt: now } };
  assert.deepEqual(parseSession(serializeSession(session), now), session);
  assert.equal(parseSession(null, now), undefined);
  assert.equal(parseSession("not-json", now), undefined);
  assert.equal(parseSession(serializeSession({ ...session, expiresAt: now }), now), undefined);
  assert.equal(parseSession(serializeSession({ ...session, githubId: "123" }), now), undefined);
  assert.equal(parseSession(serializeSession({ ...session, login: "" }), now), undefined);
});

test("session cookies and no-store headers match protected-response requirements", () => {
  assert.equal(sessionTtlSeconds, 60 * 60 * 8);
  assert.deepEqual(cookieOptions(sessionTtlSeconds, "production"), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: sessionTtlSeconds,
  });
  assert.equal(Object.hasOwn(cookieOptions(sessionTtlSeconds, "production"), "domain"), false);
  assert.equal(noStoreHeaders["cache-control"], "private, no-store, max-age=0");
});

test("secret values are not embedded in auth error messages", () => {
  const secret = "gho_secret_token_value";
  for (const message of [
    "github_exchange_failed",
    "github_identity_failed",
    "Authentication required",
  ]) {
    assert.equal(message.includes(secret), false);
  }
});

test("GET sign-out route does not destroy session state while POST does", async () => {
  const route = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../app/sign-out/route.ts", import.meta.url), "utf8"));
  const getBody = route.match(/export async function GET[\s\S]*?\n}\n/)?.[0] ?? "";
  const postBody = route.match(/export async function POST[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.equal(getBody.includes("destroySession"), false);
  assert.equal(postBody.includes("destroySession"), true);
});

test("protected API routes authenticate before loading artifacts or creating variations", async () => {
  const fs = await import("node:fs/promises");
  const artifactsRoute = await fs.readFile(new URL("../app/api/artifacts/route.ts", import.meta.url), "utf8");
  assert.match(artifactsRoute, /const authError = await requireApiAuth\(request\);\n  if \(authError\) return authError;\n  const \{ searchParams \}/);
  assert.equal(artifactsRoute.indexOf("requireApiAuth(request)") < artifactsRoute.indexOf("getArtifacts()"), true);

  const variationRoute = await fs.readFile(new URL("../app/api/artifacts/[id]/variation/route.ts", import.meta.url), "utf8");
  assert.match(variationRoute, /const authError = await requireApiAuth\(request\);\n  if \(authError\) return authError;\n  const \{ id \}/);
  assert.equal(variationRoute.indexOf("requireApiAuth(request)") < variationRoute.indexOf("getArtifact(id)"), true);
  assert.equal(variationRoute.indexOf("requireApiAuth(request)") < variationRoute.indexOf("createVariation(source"), true);
});

const storeModuleUrl = pathToFileURL(new URL("../lib/auth-session-store.ts", import.meta.url).pathname).href;
const { findSession, hashSessionId, insertSession, revokeSessionId } = await import(storeModuleUrl);

function createFakeD1() {
  const rows = new Map();
  const calls = [];
  return {
    rows,
    calls,
    prepare(query) {
      calls.push(query);
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async run() {
          if (query.startsWith("INSERT")) {
            rows.set(this.values[0], {
              id: this.values[0],
              github_id: this.values[1],
              login: this.values[2],
              name: this.values[3],
              avatar_url: this.values[4],
              expires_at: this.values[5],
              created_at: this.values[6],
              revoked_at: null,
              authorization_state: this.values[7],
              denial_reason: this.values[8],
              repository_owner: this.values[9],
              repository_name: this.values[10],
              repository_id: this.values[11],
              installation_id: this.values[12],
              authorization_checked_at: this.values[13],
              encrypted_user_access_token: this.values[14],
              user_access_token_expires_at: this.values[15],
              token_iv: this.values[16],
            });
          } else if (query.startsWith("UPDATE")) {
            const row = rows.get(this.values[1]);
            if (row && row.revoked_at === null) row.revoked_at = this.values[0];
          }
          return {};
        },
        async first() {
          return rows.get(this.values[0]) ?? null;
        },
      };
    },
  };
}

test("D1 session store persists an HMAC key, finds valid sessions, and rejects unknown, expired, and revoked sessions", async () => {
  const database = createFakeD1();
  const secret = "session-secret-that-is-at-least-32-bytes";
  const now = Date.UTC(2026, 6, 13);
  const session = { id: "raw-cookie-session-id", githubId: 123, login: "octocat", createdAt: now, expiresAt: now + 60_000, repositoryAuthorization: { state: "authorized", owner: "owner", repo: "repo", login: "octocat", githubId: 123, repositoryId: 1, installationId: 2, checkedAt: now } };
  const storedId = await insertSession(database, secret, session, now);

  assert.notEqual(storedId, session.id);
  assert.equal(storedId, await hashSessionId(session.id, secret));
  assert.equal(database.rows.has(session.id), false);
  assert.deepEqual(await findSession(database, secret, session.id, now), session);
  assert.equal(await findSession(database, secret, "unknown-session", now), undefined);
  assert.equal(await findSession(database, secret, session.id, session.expiresAt), undefined);

  await revokeSessionId(database, secret, session.id, now + 1);
  await revokeSessionId(database, secret, session.id, now + 2);
  assert.equal(database.rows.get(storedId).revoked_at, now + 1);
  assert.equal(await findSession(database, secret, session.id, now + 3), undefined);
  assert.equal(database.calls.some((query) => query.includes("CREATE TABLE")), false);
});

test("sign-in page renders only a local OAuth start URL and does not import cookie-mutating OAuth start helpers", async () => {
  const fs = await import("node:fs/promises");
  const page = await fs.readFile(new URL("../app/sign-in/page.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("createOAuthStart"), false);
  assert.equal(page.includes("cookies().set"), false);
  assert.equal(page.includes("/auth/github/start?returnTo="), true);
});

test("page-level session lookup does not delete or set stale cookies", async () => {
  const fs = await import("node:fs/promises");
  const auth = await fs.readFile(new URL("../lib/auth.ts", import.meta.url), "utf8");
  const getSessionBody = auth.match(/export async function getSession\(\)[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.equal(getSessionBody.includes("cookieStore.delete"), false);
  assert.equal(getSessionBody.includes("cookieStore.set"), false);
});

const repositoryAuthorizationModuleUrl = pathToFileURL(new URL("../lib/repository-authorization.ts", import.meta.url).pathname).href;
const {
  createRepositoryAuthorizationRecord,
  repositoryAccessDeniedMessages,
  verifyRepositoryAuthorization,
} = await import(repositoryAuthorizationModuleUrl);

async function testPrivateKeyPem() {
  const key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key.privateKey));
  const b64 = Buffer.from(pkcs8).toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`;
}
function appConfig(overrides = {}) { return { appId: "123", clientId: "client", clientSecret: "secret", privateKey: overrides.privateKey ?? "unused", owner: "owner", repo: "repo", branch: "main", rootPath: "artifacts", allowedLogins: [], ...overrides }; }

test("repository authorisation enforces optional login allowlist before GitHub repository checks", async () => {
  let called = false;
  const status = await verifyRepositoryAuthorization(
    { id: 123, login: "octocat" },
    "user-token",
    appConfig({ allowedLogins: ["maintainer"] }),
    async () => {
      called = true;
      return new Response("{}", { status: 200 });
    },
  );

  assert.deepEqual(status, { ok: false, reason: "allowlist", message: repositoryAccessDeniedMessages.allowlist });
  assert.equal(called, false);
});

test("repository authorisation requires app and signed-in user access to the exact configured repository", async () => {
  const calls = [];
  const privateKey = await testPrivateKeyPem();
  const okStatus = await verifyRepositoryAuthorization(
    { id: 123, login: "OctoCat" },
    "user-token",
    appConfig({ privateKey, repo: "private-artifacts", allowedLogins: ["octocat"] }),
    async (url, init) => {
      calls.push({ url: String(url), authorization: init?.headers.authorization });
      const path = new URL(String(url)).pathname;
      if (path === "/repos/owner/private-artifacts") return new Response(JSON.stringify({ id: 99, name: "private-artifacts", owner: { login: "owner" } }), { status: 200 });
      if (path === "/repos/owner/private-artifacts/installation") return new Response(JSON.stringify({ id: 77 }), { status: 200 });
      return new Response("{}", { status: 404 });
    },
  );

  assert.equal(okStatus.ok, true);
  assert.equal(okStatus.owner, "owner");
  assert.equal(okStatus.repo, "private-artifacts");
  assert.equal(okStatus.login, "OctoCat");
  assert.deepEqual(calls.map((call) => call.url), [
    "https://api.github.com/repos/owner/private-artifacts",
    "https://api.github.com/repos/owner/private-artifacts/installation",
  ]);
  assert.deepEqual(createRepositoryAuthorizationRecord(okStatus, 1234), { state: "authorized", owner: "owner", repo: "private-artifacts", login: "OctoCat", githubId: 123, repositoryId: 99, installationId: 77, checkedAt: 1234 });
});

test("repository authorisation distinguishes app installation and user repository failures", async () => {
  const appFailure = await verifyRepositoryAuthorization(
    { id: 123, login: "octocat" },
    "user-token",
    appConfig({ privateKey: await testPrivateKeyPem() }),
    async (url) => String(url).endsWith("/installation") ? new Response("{}", { status: 404 }) : new Response(JSON.stringify({ id: 1, name: "repo", owner: { login: "owner" } }), { status: 200 }),
  );
  assert.deepEqual(appFailure, { ok: false, reason: "app_access", message: repositoryAccessDeniedMessages.app_access, temporary: false });

  let count = 0;
  const userFailure = await verifyRepositoryAuthorization(
    { id: 123, login: "octocat" },
    "user-token",
    appConfig({ privateKey: await testPrivateKeyPem() }),
    async () => new Response("{}", { status: ++count === 1 ? 404 : 200 }),
  );
  assert.deepEqual(userFailure, { ok: false, reason: "user_access", message: repositoryAccessDeniedMessages.user_access });
});

test("repository authorisation sessions and protected routes carry repository decisions", async () => {
  const now = Date.UTC(2026, 6, 13);
  const session = {
    id: randomToken(48),
    githubId: 123,
    login: "octocat",
    expiresAt: now + 1000,
    repositoryAuthorization: { state: "authorized", owner: "owner", repo: "repo", login: "octocat", githubId: 123, repositoryId: 1, installationId: 2, checkedAt: now },
  };
  assert.deepEqual(parseSession(serializeSession(session), now), session);
  assert.equal(parseSession(serializeSession({ ...session, repositoryAuthorization: { ...session.repositoryAuthorization, repo: "" } }), now), undefined);

  const fs = await import("node:fs/promises");
  const homePage = await fs.readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.equal(homePage.includes("requireRepositoryAuthorization"), true);
  assert.equal(homePage.indexOf("requireRepositoryAuthorization") < homePage.indexOf("getArtifacts()"), true);

  const artifactsRoute = await fs.readFile(new URL("../app/api/artifacts/route.ts", import.meta.url), "utf8");
  assert.equal(artifactsRoute.includes("requireApiAuth(request)"), true);
});
