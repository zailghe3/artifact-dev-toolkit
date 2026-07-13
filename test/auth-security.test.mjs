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
  assert.deepEqual(cookieOptions(oauthStateTtlSeconds), {
    httpOnly: true,
    secure: true,
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
    assert.throws(() => validateGitHubUser(value), /valid user identity/);
  }
});

test("session parsing rejects missing, malformed, expired, revoked, and unknown session values", () => {
  const now = Date.UTC(2026, 6, 13);
  const session = { id: randomToken(48), githubId: 123, login: "octocat", expiresAt: now + 1000 };
  assert.deepEqual(parseSession(serializeSession(session), now), session);
  assert.equal(parseSession(null, now), undefined);
  assert.equal(parseSession("not-json", now), undefined);
  assert.equal(parseSession(serializeSession({ ...session, expiresAt: now }), now), undefined);
  assert.equal(parseSession(serializeSession({ ...session, githubId: "123" }), now), undefined);
  assert.equal(parseSession(serializeSession({ ...session, login: "" }), now), undefined);
});

test("session cookies and no-store headers match protected-response requirements", () => {
  assert.equal(sessionTtlSeconds, 60 * 60 * 8);
  assert.deepEqual(cookieOptions(sessionTtlSeconds), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: sessionTtlSeconds,
  });
  assert.equal(Object.hasOwn(cookieOptions(sessionTtlSeconds), "domain"), false);
  assert.equal(noStoreHeaders["cache-control"], "private, no-store, max-age=0");
});

test("secret values are not embedded in auth error messages", () => {
  const secret = "gho_secret_token_value";
  for (const message of [
    "GitHub token exchange failed.",
    "GitHub user lookup failed.",
    "GitHub did not return a valid user identity.",
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
