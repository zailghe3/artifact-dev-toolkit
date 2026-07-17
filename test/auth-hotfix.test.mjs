import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";

const config = await import(pathToFileURL(new URL("../lib/auth-configuration.ts", import.meta.url).pathname).href);
const github = await import(pathToFileURL(new URL("../lib/github-app.ts", import.meta.url).pathname).href);
const smoke = await import("../scripts/smoke-test-oauth-start.mjs");

test("encryption key validation is typed, strict, and trims whitespace", () => {
  assert.equal(config.validateTokenEncryptionKey(`  ${Buffer.alloc(32).toString("base64")}\n`).length, 32);
  for (const [value, code] of [["not base64!", "invalid_encryption_key_format"], ['"' + Buffer.alloc(32).toString("base64") + '"', "invalid_encryption_key_format"], [Buffer.alloc(31).toString("base64"), "invalid_encryption_key_length"]]) {
    assert.throws(() => config.validateTokenEncryptionKey(value), (error) => error instanceof config.AuthenticationConfigurationError && error.code === code && !error.message.includes(value));
  }
});

test("missing and short session security configuration fails without values", () => {
  const saved = { SESSION_SECRET: process.env.SESSION_SECRET, GITHUB_TOKEN_ENCRYPTION_KEY: process.env.GITHUB_TOKEN_ENCRYPTION_KEY };
  try {
    delete process.env.SESSION_SECRET; delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    assert.throws(() => config.getSessionSecurityConfig(), (error) => error.code === "missing_configuration" && error.missingNames.includes("SESSION_SECRET"));
    process.env.SESSION_SECRET = "secret-value"; process.env.GITHUB_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32).toString("base64");
    assert.throws(() => config.getSessionSecurityConfig(), (error) => error.code === "invalid_session_secret" && !error.message.includes("secret-value"));
  } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("GitHub App JWT accepts equivalent PKCS#8 and PKCS#1 RSA keys", async () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs8 = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pkcs1 = pair.privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  for (const pem of [pkcs8, pkcs1]) {
    const jwt = await github.createGitHubAppJwt("123", pem, 2_000_000_000);
    assert.equal(jwt.split(".").length, 3);
    const [header, payload, signature] = jwt.split(".");
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", await crypto.subtle.importKey("spki", pair.publicKey.export({ type: "spki", format: "der" }), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]), Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${payload}`));
    assert.equal(valid, true);
  }
});

test("malformed and unsupported PEM fail with value-free typed errors", async () => {
  for (const pem of ["-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----", "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----"]) {
    await assert.rejects(github.createGitHubAppJwt("123", pem), (error) => error.code === "invalid_private_key" && !error.message.includes("AAAA"));
  }
});

function response(status, location) { return new Response(null, { status, headers: location ? { location } : {} }); }
const validLocation = "https://github.com/login/oauth/authorize?client_id=id&state=state&code_challenge=challenge&code_challenge_method=S256";
test("OAuth smoke test accepts only a complete GitHub PKCE redirect", async () => {
  await smoke.smokeTestOAuthStart(async (_url, init) => { assert.equal(init.redirect, "manual"); return response(302, validLocation); });
  for (const result of [response(500), response(302), response(302, "https://example.com/"), response(302, "https://github.com/login/oauth/authorize?client_id=id&state=x")]) await assert.rejects(smoke.smokeTestOAuthStart(async () => result));
});

test("Wrangler declares auth secrets and explicit production repository", () => {
  const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  for (const name of ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_TOKEN_ENCRYPTION_KEY", "SESSION_SECRET"]) assert.match(source, new RegExp(`"${name}"`));
  assert.match(source, /"ARTIFACT_REPOSITORY": "github"/); assert.match(source, /"GITHUB_ARTIFACT_REPOSITORY_OWNER": "zailghe3"/); assert.match(source, /"GITHUB_ARTIFACT_REPOSITORY_NAME": "fpo-artifacts"/);
});
