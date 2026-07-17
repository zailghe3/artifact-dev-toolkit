import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";

const load = path => import(pathToFileURL(new URL(path, import.meta.url).pathname).href);
const config = await load("../lib/auth-configuration.ts");
const github = await load("../lib/github-app.ts");
const routes = await load("../lib/oauth-route-handlers.ts");
const repositoryAuthorization = await load("../lib/repository-authorization.ts");
const smoke = await import("../scripts/smoke-test-oauth-start.mjs");
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs8 = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pkcs1 = pair.privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const requiredEnvironment = {
  ARTIFACT_REPOSITORY: "github", GITHUB_APP_ID: "123", GITHUB_APP_CLIENT_ID: "client-value", GITHUB_APP_CLIENT_SECRET: "client-secret-value",
  GITHUB_APP_PRIVATE_KEY: pkcs8, GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  GITHUB_ARTIFACT_REPOSITORY_OWNER: "zailghe3", GITHUB_ARTIFACT_REPOSITORY_NAME: "fpo-artifacts", SESSION_SECRET: "s".repeat(48),
};

async function withEnvironment(values, callback) {
  const saved = Object.fromEntries(Object.keys(requiredEnvironment).map(name => [name, process.env[name]]));
  try { Object.assign(process.env, requiredEnvironment, values); for (const [name, value] of Object.entries(values)) if (value === undefined) delete process.env[name]; return await callback(); }
  finally { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
}

test("production readiness validates every setting, secret shape, backend, and private-key import", async () => {
  await withEnvironment({}, () => config.validateProductionAuthReadiness());
  for (const name of Object.keys(requiredEnvironment)) await withEnvironment({ [name]: undefined }, async () => {
    await assert.rejects(config.validateProductionAuthReadiness(), error => error instanceof config.AuthenticationConfigurationError && error.missingNames.includes(name));
  });
  for (const values of [{ SESSION_SECRET: "short-secret" }, { GITHUB_TOKEN_ENCRYPTION_KEY: "not base64!" }, { GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64") }, { GITHUB_APP_PRIVATE_KEY: "bad-pem" }, { ARTIFACT_REPOSITORY: "file" }]) {
    await withEnvironment(values, () => assert.rejects(config.validateProductionAuthReadiness(), config.AuthenticationConfigurationError));
  }
});

test("encryption key validation is typed, strict, and trims whitespace", () => {
  assert.equal(config.validateTokenEncryptionKey(`  ${Buffer.alloc(32).toString("base64")}\n`).length, 32);
  for (const [value, code] of [["not base64!", "invalid_encryption_key_format"], ['"' + Buffer.alloc(32).toString("base64") + '"', "invalid_encryption_key_format"], [Buffer.alloc(31).toString("base64"), "invalid_encryption_key_length"]]) {
    assert.throws(() => config.validateTokenEncryptionKey(value), error => error.code === code && !error.message.includes(value));
  }
});

test("GitHub App JWT accepts independently verifiable PKCS#8 and PKCS#1 keys", async () => {
  for (const pem of [pkcs8, pkcs1]) {
    const jwt = await github.createGitHubAppJwt("123", pem, 2_000_000_000);
    const [header, payload, signature] = jwt.split(".");
    const key = await crypto.subtle.importKey("spki", pair.publicKey.export({ type: "spki", format: "der" }), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    assert.equal(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${payload}`)), true);
  }
});

test("every unsupported or malformed private key fails with a value-free typed error", async () => {
  const invalid = ["", "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----", "-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----", "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----", "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----", "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----\nnot_base64!\n-----END PRIVATE KEY-----"];
  for (const pem of invalid) await assert.rejects(github.validateGitHubAppPrivateKey(pem), error => error instanceof config.AuthenticationConfigurationError && error.code === "invalid_private_key" && (!pem || !error.message.includes(pem)));
});

test("repository configuration trims required values and never swallows private-key configuration errors", async () => {
  await withEnvironment({ GITHUB_ARTIFACT_REPOSITORY_OWNER: "   " }, () => assert.throws(repositoryAuthorization.getRepositoryAuthorizationConfig, error => error.missingNames.includes("GITHUB_ARTIFACT_REPOSITORY_OWNER")));
  const repositoryResponse = { id: 1, name: "fpo-artifacts", owner: { login: "zailghe3" } };
  await assert.rejects(repositoryAuthorization.verifyRepositoryAuthorization({ id: 1, login: "user" }, "user-token", {
    appId: "123", clientId: "client", clientSecret: "secret", privateKey: "bad-pem", owner: "zailghe3", repo: "fpo-artifacts", branch: "main", rootPath: "artifacts", allowedLogins: [],
  }, async () => Response.json(repositoryResponse)), error => error instanceof config.AuthenticationConfigurationError && error.code === "invalid_private_key");
});

function location(response) { return new URL(response.headers.get("location")); }
test("OAuth start route redirects safely for valid, configuration, malformed, and unexpected outcomes", async () => {
  const logs = [];
  const valid = routes.createOAuthStartRouteHandler({ createOAuthStart: async () => new URL("https://github.com/login/oauth/authorize?client_id=id&state=state&code_challenge=pkce"), logger: value => logs.push(value) });
  let response = await valid(new Request("https://service.test/auth/github/start?returnTo=%2Fartifacts%2Fone"));
  assert.equal(response.status, 307); assert.equal(location(response).origin, "https://github.com");
  const failures = ["ARTIFACT_REPOSITORY", "GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_TOKEN_ENCRYPTION_KEY", "GITHUB_ARTIFACT_REPOSITORY_OWNER", "GITHUB_ARTIFACT_REPOSITORY_NAME", "SESSION_SECRET"];
  for (const name of failures) {
    const handler = routes.createOAuthStartRouteHandler({ createOAuthStart: async () => { throw new config.AuthenticationConfigurationError("missing_configuration", [name]); }, logger: value => logs.push(value) });
    response = await handler(new Request("https://service.test/auth/github/start?returnTo=%2Fartifacts%2Fone"));
    assert.equal(location(response).pathname + location(response).search, "/sign-in?error=configuration&returnTo=%2Fartifacts%2Fone");
  }
  for (const code of ["invalid_session_secret", "invalid_encryption_key_format", "invalid_encryption_key_length", "invalid_private_key"]) {
    const handler = routes.createOAuthStartRouteHandler({ createOAuthStart: async () => { throw new config.AuthenticationConfigurationError(code); }, logger: value => logs.push(value) });
    assert.equal(location(await handler(new Request("https://service.test/auth/github/start"))).searchParams.get("error"), "configuration");
  }
  const unexpected = routes.createOAuthStartRouteHandler({ createOAuthStart: async () => { throw new Error("secret-value state-value pkce-value"); }, logger: value => logs.push(value) });
  assert.equal(location(await unexpected(new Request("https://service.test/auth/github/start?returnTo=https://evil.test"))).href, "https://service.test/sign-in?error=oauth_start_failed");
  assert.doesNotMatch(JSON.stringify(logs), /secret-value|state-value|pkce-value|client-secret-value|BEGIN PRIVATE KEY|cookie/i);
});

test("OAuth callback route returns secret-free redirects and diagnostic categories for every failure stage", async () => {
  const cases = [
    ["invalid_state", { state: { valid: false, returnTo: "/", pkceVerifier: "verifier-secret" } }, "invalid_state"],
    ["authorization_denied", { url: "?state=x&error=access_denied" }, "denied"], ["missing_code", { url: "?state=x" }, "missing_code"],
    ["token_exchange", { exchangeError: Object.assign(new Error("token-secret"), { category: "token_exchange" }) }, "github_exchange_failed"],
    ["identity_lookup", { exchangeError: Object.assign(new Error("body-secret"), { category: "identity_lookup" }) }, "github_identity_failed"],
    ["repository_configuration", { exchangeError: new config.AuthenticationConfigurationError("invalid_private_key") }, "configuration"],
    ["session_configuration", { sessionError: new config.AuthenticationConfigurationError("invalid_session_secret") }, "configuration"],
    ["session_persistence", { sessionError: new Error("D1 cookie secret") }, "session_creation_failed"], ["unexpected", { exchangeError: new Error("unexpected secret") }, "github_exchange_failed"],
  ];
  for (const [category, setup, expected] of cases) {
    const logs = [];
    const handler = routes.createOAuthCallbackRouteHandler({
      consumeOAuthState: async () => setup.state ?? { valid: true, returnTo: "/artifacts/one", pkceVerifier: "verifier-secret" },
      exchangeGitHubCode: async () => { if (setup.exchangeError) throw setup.exchangeError; return { user: { id: 1, login: "user" }, repositoryAuthorization: { ok: false, reason: "configuration", message: "safe" }, userAccessToken: "token-secret", userTokenExpiresAt: Date.now() }; },
      createSession: async () => { if (setup.sessionError) throw setup.sessionError; }, logger: value => logs.push(value),
    });
    const response = await handler(new Request(`https://service.test/auth/github/callback${setup.url ?? "?state=x&code=code-secret"}`));
    assert.equal(response.status, 307); assert.equal(location(response).searchParams.get("error"), expected); assert.match(logs.join(""), new RegExp(`"category":"${category}"`));
    assert.doesNotMatch(response.headers.get("location") + logs.join(""), /token-secret|code-secret|verifier-secret|body-secret|D1 cookie secret|unexpected secret/);
  }
});

function response(status, redirectLocation) { return new Response(null, { status, headers: redirectLocation ? { location: redirectLocation } : {} }); }
const validLocation = "https://github.com/login/oauth/authorize?client_id=id&state=state&code_challenge=challenge&code_challenge_method=S256";
test("OAuth smoke retries transient failures, exhausts deterministically, times out, and rejects malformed redirects immediately", async () => {
  let calls = 0;
  await smoke.smokeTestOAuthStart(async () => (++calls < 3 ? response(503) : response(302, validLocation)), smoke.productionOAuthStartUrl, { attempts: 3, sleep: async () => {} }); assert.equal(calls, 3);
  await assert.rejects(smoke.smokeTestOAuthStart(async () => response(302, "/sign-in?error=configuration"), smoke.productionOAuthStartUrl, { attempts: 2, sleep: async () => {} }), /Retry limit reached/);
  await assert.rejects(smoke.smokeTestOAuthStart((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error(), { name: "AbortError" })))), smoke.productionOAuthStartUrl, { attempts: 1, timeoutMs: 1 }), /timed out/);
  calls = 0; await assert.rejects(smoke.smokeTestOAuthStart(async () => { calls += 1; return response(302, "https://example.com/"); }, smoke.productionOAuthStartUrl, { attempts: 4, sleep: async () => {} }), /did not redirect to GitHub/); assert.equal(calls, 1);
});

test("Wrangler structurally declares exactly the intended secrets and production repository", () => {
  const wrangler = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(wrangler.secrets.required, ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_TOKEN_ENCRYPTION_KEY", "SESSION_SECRET"]);
  assert.deepEqual(wrangler.vars, { ARTIFACT_REPOSITORY: "github", GITHUB_ARTIFACT_REPOSITORY_OWNER: "zailghe3", GITHUB_ARTIFACT_REPOSITORY_NAME: "fpo-artifacts" });
});
