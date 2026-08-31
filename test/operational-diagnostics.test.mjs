import test from "node:test";
import assert from "node:assert/strict";
import { installTsxHook } from "./render-tsx.mjs";
const require = installTsxHook();
const { authenticationDiagnosticChecks, deriveOperationalDomains, operationalContributors, operationalOverall, runnerDiagnosticChecks, runtimeDiagnosticChecks } = require("../lib/operational-diagnostics.ts");
const { collectSafeRunnerDiagnostics } = require("../lib/codex-runner-diagnostics.ts");

const runtime = (changes = {}) => ({ configured: true, reachable: true, authenticationAccepted: true, protocolCompatible: true, capabilityAvailable: true, graphCapabilityAvailable: true, wrappingKeyMatches: true, runtimeRevision: "runtime-revision", elapsedMs: 12, ...changes });
const connection = (changes = {}) => ({ state: "connected", label: "Connected to ChatGPT", capabilities: { protocolVersion: 1, runnerVersion: "a".repeat(40), codexAvailable: true, deviceAuth: true, jobExecution: true, releaseMetadata: "current", runnerRevision: 1, codexVersion: "1.2.3" }, compatibility: { protocol: "compatible", runnerRevision: "current", codexVersion: "current" }, auth: { connected: true }, ...changes });
const authEnvironment = { runnerReachable: true, codexAppServerReady: true, codexVersionMatchesExpected: true, systemCaBundlePresent: true, systemCaBundleReadable: true, systemCaBundleNonEmpty: true, codexHomeReadable: true, codexHomeWritable: true, dnsResolution: "ok" };
const runner = (changes = {}) => ({ connection: connection(), control: { state: "available", value: { emergencyStopped: false, updatedAt: "2026-01-01T00:00:00Z", hardRestart: { attempted: false, succeeded: false }, role: "integrated", executor: null } }, environments: { state: "available", value: [] }, jobs: { state: "available", value: { capacity: { maxActive: 1, activeJobId: null }, jobs: [] } }, authEnvironment: { state: "available", value: authEnvironment }, ...changes });
const configuredSecrets = { GITHUB_APP_ID: "configured", GITHUB_APP_CLIENT_ID: "configured", GITHUB_APP_CLIENT_SECRET: "configured", GITHUB_APP_PRIVATE_KEY: "configured", GITHUB_TOKEN_ENCRYPTION_KEY: "configured", SESSION_SECRET: "configured" };
const repository = (changes = {}) => ({ identity: { login: "operator", githubId: 42 }, configuration: { backend: "github", owner: "acme", repository: "artifacts", branch: "main", artifactRoot: "artifacts", cacheBinding: "configured", authSecrets: { ...configuredSecrets } }, authorization: { repositoryMatches: true, liveState: "authorized" }, installation: { state: "detected" }, permissions: { contentsRead: { effective: true, reason: "granted" }, contentsWrite: { effective: true, reason: "granted" } }, repositoryRevision: { state: "available", value: "abc" }, cache: { state: "fresh" }, validation: { state: "valid" }, ...changes });

const domain = (repo = repository(), runtimeValue = runtime(), runnerValue = runner(), key = "authentication-access") => deriveOperationalDomains(repo, runtimeValue, runnerValue, true).find(item => item.key === key);

test("repository/auth aggregation covers every visible access and grouped configuration check", () => {
  assert.equal(domain().state, "healthy");
  const mismatch = repository({ authorization: { repositoryMatches: false, liveState: "not_checked" } });
  const mismatchDomain = domain(mismatch);
  assert.equal(mismatchDomain.state, "failed");
  assert.ok(operationalContributors(deriveOperationalDomains(mismatch, runtime(), runner(), true), 20).contributors.some(item => item.href === "#repository-match"));
  for (const [name, state, id] of [["GITHUB_APP_ID", "missing", "github-app-configuration"], ["SESSION_SECRET", "invalid", "session-configuration"], ["GITHUB_TOKEN_ENCRYPTION_KEY", "missing", "token-encryption-configuration"]]) {
    const value = repository(); value.configuration.authSecrets[name] = state;
    const access = domain(value); assert.equal(access.state, "failed", id);
    assert.ok(operationalContributors(deriveOperationalDomains(value, runtime(), runner(), true), 20).contributors.some(item => item.href === `#${id}`));
  }
  const unknown = repository({ authorization: { repositoryMatches: "unknown", liveState: "not_checked" }, installation: { state: "unknown" }, permissions: { contentsRead: { effective: "unknown", reason: "not_checked" }, contentsWrite: { effective: "unknown", reason: "not_checked" } } });
  assert.equal(domain(unknown).state, "degraded");
});

test("every visible negative auth check contributes to bounded needs attention without secrets", () => {
  const value = repository({ authorization: { repositoryMatches: false, liveState: "denied" }, installation: { state: "missing" }, permissions: { contentsRead: { effective: false, reason: "permission_missing" }, contentsWrite: { effective: false, reason: "permission_missing" } } });
  for (const name of Object.keys(value.configuration.authSecrets)) value.configuration.authSecrets[name] = "missing";
  const domains = deriveOperationalDomains(value, runtime(), runner(), true), contributors = operationalContributors(domains, 30);
  const negativeIds = authenticationDiagnosticChecks(value).filter(check => check.status.tone === "negative").map(check => `#${check.id}`);
  assert.ok(negativeIds.every(href => contributors.contributors.some(item => item.href === href)));
  assert.doesNotMatch(JSON.stringify(contributors), /GITHUB_APP_PRIVATE_KEY|SESSION_SECRET|provider-secret|ciphertext/i);
});

test("Artifact Library includes repository, revision, cache binding, cache, and validation health", () => {
  const value = repository(); value.configuration.cacheBinding = "missing";
  const library = domain(value, runtime(), runner(), "artifact-library");
  assert.equal(library.state, "failed"); assert.ok(library.checks.some(check => check.id === "cache-binding"));
});

test("Runtime requires configuration and both current-main capabilities with prerequisite semantics", () => {
  assert.equal(domain(repository(), runtime({ configured: false }), runner(), "adt-runtime").state, "failed");
  assert.equal(operationalOverall(deriveOperationalDomains(repository(), runtime({ configured: false }), runner(), true)).state, "failed");
  assert.equal(domain(repository(), runtime({ graphCapabilityAvailable: false }), runner(), "adt-runtime").state, "failed");
  assert.equal(domain(repository(), runtime({ capabilityAvailable: false }), runner(), "adt-runtime").state, "failed");
  assert.equal(domain(repository(), runtime(), runner(), "adt-runtime").state, "healthy");
  const unreachable = runtimeDiagnosticChecks(runtime({ reachable: false, authenticationAccepted: null, protocolCompatible: false, capabilityAvailable: false, graphCapabilityAvailable: false, wrappingKeyMatches: false }));
  for (const id of ["runtime-authentication", "runtime-protocol", "runtime-capability", "runtime-graph-capability", "runtime-wrapping-key"]) assert.equal(unreachable.find(check => check.id === id).status.label, "Not verified");
});

test("Runner operational observations and CLI compatibility prevent false Healthy claims", () => {
  const cases = [
    runner({ control: { state: "available", value: { emergencyStopped: true, updatedAt: "2026-01-01T00:00:00Z", hardRestart: { attempted: false, succeeded: false }, role: "integrated", executor: null } } }),
    runner({ control: { state: "available", value: { emergencyStopped: false, updatedAt: "2026-01-01T00:00:00Z", hardRestart: { attempted: false, succeeded: false }, role: "controller", executor: { healthy: false, generation: "g", activeExecutionId: null, activity: null, boundary: "container" } } } }),
    runner({ environments: { state: "available", value: [{ environment: { key: "dev", name: "Dev", enabled: true, ready: true, sandbox: "workspace-write" }, workspace: { state: "unavailable" }, sandbox: { state: "available", value: { environmentKey: "dev", status: "available", backend: "container", reason: "ok" } } }] } }),
    runner({ environments: { state: "available", value: [{ environment: { key: "dev", name: "Dev", enabled: true, ready: true, sandbox: "workspace-write" }, workspace: { state: "available", value: { filesystemReady: true } }, sandbox: { state: "available", value: { environmentKey: "dev", status: "unavailable", backend: "bubblewrap", reason: "permission_denied" } } }] } }),
    runner({ jobs: { state: "unavailable" } }),
    runner({ connection: connection({ compatibility: { protocol: "compatible", runnerRevision: "current", codexVersion: "mismatch" } }) }),
  ];
  for (const value of cases) assert.notEqual(domain(repository(), runtime(), value, "codex-runner").state, "healthy");
  const jobs = runnerDiagnosticChecks(cases[4]).find(check => check.id === "runner-operations"); assert.equal(jobs.status.label, "Unknown");
  assert.equal(runnerDiagnosticChecks(cases[5]).find(check => check.id === "runner-codex-cli").status.label, "Version mismatch");
  const missing = runner({ connection: { state: "configuration-missing", label: "missing" } });
  assert.equal(domain(repository(), runtime(), missing, "codex-runner").state, "not-configured");
  assert.equal(operationalOverall(deriveOperationalDomains(repository(), runtime(), missing, true)).state, "healthy");
});

test("safe Runner collector isolates read-only observations and never invokes functional or mutation methods", async () => {
  const called = [], client = { capabilities: async () => connection().capabilities, authStatus: async () => ({ connected: true }), controlStatus: async () => { called.push("controlStatus"); throw Error("private"); }, environments: async () => { called.push("environments"); return []; }, jobs: async limit => { called.push(`jobs:${limit}`); return { capacity: { maxActive: 1, activeJobId: null }, jobs: [] }; }, authEnvironmentDiagnostics: async () => { called.push("authEnvironmentDiagnostics"); return authEnvironment; }, workspaceDiagnostics: async () => { throw Error("unused"); }, sandboxDiagnostics: async () => { throw Error("unused"); }, testCodex: async () => { called.push("testCodex"); }, emergencyStop: async () => { called.push("emergencyStop"); } };
  const result = await collectSafeRunnerDiagnostics({ clientFactory: () => client, logger: () => {} });
  assert.equal(result.control.state, "unavailable"); assert.equal(result.jobs.state, "available");
  assert.deepEqual(called.sort(), ["authEnvironmentDiagnostics", "controlStatus", "environments", "jobs:5"].sort());
});

test("presentation models never serialize private Runner or secret inputs", () => {
  const value = runner(); value.privatePath = "/private/workspace"; value.token = "provider-secret";
  assert.doesNotMatch(JSON.stringify(runnerDiagnosticChecks(value)), /private\/workspace|provider-secret|token|remote|filename|authority/);
});
