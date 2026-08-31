import test from "node:test";
import assert from "node:assert/strict";
import { installTsxHook } from "./render-tsx.mjs";
const require = installTsxHook();
const { authenticationDiagnosticChecks, authEnvironmentStatusPresentation, deriveOperationalDomains, operationalContributors, operationalOverall, runnerDiagnosticChecks, runtimeDiagnosticChecks } = require("../lib/operational-diagnostics.ts");
const { collectSafeRunnerDiagnostics } = require("../lib/codex-runner-diagnostics.ts");
const { CodexRunnerError } = require("../lib/codex-runner-client.ts");

const runtime = (changes = {}) => ({ configured: true, reachable: true, authenticationAccepted: true, protocolCompatible: true, capabilityAvailable: true, graphCapabilityAvailable: true, wrappingKeyMatches: true, runtimeRevision: "runtime-revision", elapsedMs: 12, ...changes });
const connection = (changes = {}) => ({ state: "connected", label: "Connected to ChatGPT", capabilities: { protocolVersion: 1, runnerVersion: "a".repeat(40), codexAvailable: true, deviceAuth: true, jobExecution: true, releaseMetadata: "current", runnerRevision: 1, codexVersion: "1.2.3" }, compatibility: { protocol: "compatible", runnerRevision: "current", codexVersion: "current" }, auth: { connected: true }, ...changes });
const authEnvironment = { runnerReachable: true, codexAppServerReady: true, codexVersion: "1.2.3", codexVersionMatchesExpected: true, codexNativeLibc: "glibc", codexAddressPolicyApplies: true, customCaSource: "none", systemCaBundlePresent: true, systemCaBundleReadable: true, systemCaBundleNonEmpty: true, httpProxyConfigured: false, httpsProxyConfigured: false, allProxyConfigured: false, noProxyConfigured: false, dnsResolution: "ok", ipv4Available: true, ipv6Available: false, systemResolverFirstFamily: "ipv4", runnerAddressPolicy: "system_default", runnerAddressPolicyEffective: true, kernelIpv6Disabled: false, ipv4TcpConnectivity: "ok", ipv6TcpConnectivity: "unavailable", ipv4TlsConnectivity: "ok", ipv6TlsConnectivity: "unavailable", deviceAuthRoute: { responseReceived: true, status: 405 }, codexHomeReadable: true, codexHomeWritable: true, summary: [] };
const readyEnvironment = { environment: { key: "dev", name: "Dev", enabled: true, ready: true, sandbox: "workspace-write" }, workspace: { state: "available", value: { environmentKey: "dev", filesystemReady: true, gitAvailable: true, gitRepository: true, headCommit: "a".repeat(40), dirty: false } }, sandbox: { state: "available", value: { environmentKey: "dev", status: "available", backend: "container", reason: "ok" } } };
const runner = (changes = {}) => ({ connection: connection(), capabilities: { state: "available", value: connection().capabilities }, authentication: { state: "available", value: { connected: true } }, control: { state: "available", value: { emergencyStopped: false, updatedAt: "2026-01-01T00:00:00Z", hardRestart: { attempted: false, succeeded: false }, role: "integrated", executor: null } }, environments: { state: "available", value: [readyEnvironment] }, jobs: { state: "available", value: { capacity: { maxActive: 1, activeJobId: null }, jobs: [] } }, authEnvironment: { state: "available", value: authEnvironment }, ...changes });
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
  const missing = runner({ connection: { state: "configuration-missing", label: "missing" }, capabilities: { state: "unavailable", reason: "unknown" }, authentication: { state: "unavailable" } });
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

test("Runner capability evidence preserves reachability when CLI or authentication is unavailable", () => {
  const noCodexCapabilities = { ...connection().capabilities, codexAvailable: false };
  const noCodex = runner({ connection: { ...connection(), state: "unavailable", label: "Runner unavailable", capabilities: noCodexCapabilities }, capabilities: { state: "available", value: noCodexCapabilities } });
  let checks = runnerDiagnosticChecks(noCodex);
  assert.equal(checks.find(check => check.id === "runner-reachability").status.label, "Available");
  assert.equal(checks.find(check => check.id === "runner-codex-cli").status.label, "Unavailable");
  assert.notEqual(domain(repository(), runtime(), noCodex, "codex-runner").state, "healthy");

  const authUnknown = runner({ connection: { ...connection(), state: "unavailable", label: "Auth unavailable" }, authentication: { state: "unavailable" } });
  checks = runnerDiagnosticChecks(authUnknown);
  assert.equal(checks.find(check => check.id === "runner-reachability").status.label, "Available");
  assert.equal(checks.find(check => check.id === "runner-protocol").status.label, "Compatible");
  assert.equal(checks.find(check => check.id === "runner-authentication").status.label, "Unknown");
  assert.ok(checks.some(check => check.id === "runner-operations"));

  const noDeviceCapabilities = { ...connection().capabilities, deviceAuth: false };
  const noDevice = runner({ connection: { ...connection(), state: "update-required", label: "Update", capabilities: noDeviceCapabilities }, capabilities: { state: "available", value: noDeviceCapabilities } });
  checks = runnerDiagnosticChecks(noDevice);
  assert.equal(checks.find(check => check.id === "runner-protocol").status.label, "Compatible");
  assert.equal(checks.find(check => check.id === "runner-device-auth").status.label, "Unavailable");

  const unreachable = runner({ connection: { state: "unavailable", label: "Unavailable" }, capabilities: { state: "unavailable", reason: "unreachable" }, authentication: { state: "unavailable" } });
  assert.equal(runnerDiagnosticChecks(unreachable).find(check => check.id === "runner-reachability").status.label, "Unavailable");
});

test("Runner Healthy readiness requires at least one enabled ready environment", () => {
  for (const environments of [[], [{ ...readyEnvironment, environment: { ...readyEnvironment.environment, enabled: false } }], [{ ...readyEnvironment, environment: { ...readyEnvironment.environment, ready: false } }]]) {
    const value = runner({ environments: { state: "available", value: environments } });
    assert.equal(domain(repository(), runtime(), value, "codex-runner").state, "failed");
  }
  const healthy = runner();
  assert.equal(runnerDiagnosticChecks(healthy).find(check => check.id === "runner-environments").status.label, "Ready");
  assert.equal(domain(repository(), runtime(), healthy, "codex-runner").state, "healthy");
});

test("auth-environment health requires a viable bounded TLS route and readable configured CA", () => {
  assert.equal(authEnvironmentStatusPresentation(authEnvironment).tone, "positive");
  assert.equal(authEnvironmentStatusPresentation({ ...authEnvironment, ipv6Available: true, ipv4TlsConnectivity: "failed", ipv6TlsConnectivity: "failed", deviceAuthRoute: { responseReceived: false } }).tone, "negative");
  assert.equal(authEnvironmentStatusPresentation({ ...authEnvironment, dnsResolution: "ok", ipv4TlsConnectivity: "failed", ipv6TlsConnectivity: "unavailable", deviceAuthRoute: { responseReceived: false } }).tone, "negative");
  assert.equal(authEnvironmentStatusPresentation({ ...authEnvironment, customCaSource: "ssl_cert_file", customCaFileReadable: false }).tone, "negative");
  assert.equal(authEnvironmentStatusPresentation({ ...authEnvironment, dnsResolution: "failed", ipv4TlsConnectivity: "failed", deviceAuthRoute: { responseReceived: true, status: 405 }, httpsProxyConfigured: true }).tone, "negative");
  assert.equal(authEnvironmentStatusPresentation({ ...authEnvironment, ipv4Available: false, ipv6Available: true, ipv4TlsConnectivity: "unavailable", ipv6TlsConnectivity: "ok" }).tone, "positive");
  assert.equal(authEnvironmentStatusPresentation({ ...authEnvironment, ipv6Available: true, ipv4TlsConnectivity: "failed", ipv6TlsConnectivity: "failed", deviceAuthRoute: { responseReceived: true, status: 407 } }).tone, "negative");
});

test("historical restart failure follows current execution-boundary health", () => {
  const failedRestart = { attempted: true, succeeded: false, reason: "request_failed" };
  const active = runner({ control: { state: "available", value: { emergencyStopped: true, updatedAt: "2026-01-01T00:00:00Z", hardRestart: failedRestart, role: "controller", executor: { healthy: true, generation: "new", activeExecutionId: null, activity: null, boundary: "container" } } } });
  assert.equal(runnerDiagnosticChecks(active).find(check => check.id === "runner-hard-restart").status.tone, "negative");
  const recovered = runner({ control: { state: "available", value: { emergencyStopped: false, updatedAt: "2026-01-01T00:00:00Z", hardRestart: failedRestart, role: "controller", executor: { healthy: true, generation: "new", activeExecutionId: null, activity: null, boundary: "container" } } } });
  assert.equal(runnerDiagnosticChecks(recovered).find(check => check.id === "runner-hard-restart").status.tone, "warning");
  assert.notEqual(domain(repository(), runtime(), recovered, "codex-runner").state, "failed");
  const unhealthy = runner({ control: { state: "available", value: { emergencyStopped: false, updatedAt: "2026-01-01T00:00:00Z", hardRestart: { attempted: true, succeeded: true }, role: "controller", executor: { healthy: false, generation: "new", activeExecutionId: null, activity: null, boundary: "container" } } } });
  assert.equal(domain(repository(), runtime(), unhealthy, "codex-runner").state, "failed");
});

test("safe Runner collector retains capability and other observations when auth status fails", async () => {
  const calls = [], client = { capabilities: async () => connection().capabilities, authStatus: async () => { throw Error("private auth body"); }, controlStatus: async () => { calls.push("control"); return runner().control.value; }, environments: async () => { calls.push("environments"); return []; }, jobs: async () => { calls.push("jobs"); return { capacity: { maxActive: 1, activeJobId: null }, jobs: [] }; }, authEnvironmentDiagnostics: async () => { calls.push("auth-environment"); return authEnvironment; }, workspaceDiagnostics: async () => { throw Error("unused"); }, sandboxDiagnostics: async () => { throw Error("unused"); } };
  const logs = [], result = await collectSafeRunnerDiagnostics({ clientFactory: () => client, logger: value => logs.push(value) });
  assert.equal(result.capabilities.state, "available");
  assert.equal(result.authentication.state, "unavailable");
  assert.equal(result.control.state, "available");
  assert.equal(result.environments.state, "available");
  assert.equal(result.jobs.state, "available");
  assert.equal(result.authEnvironment.state, "available");
  assert.doesNotMatch(JSON.stringify({ result, logs }), /private auth body/);
  assert.deepEqual(calls.sort(), ["auth-environment", "control", "environments", "jobs"].sort());
});

test("unified Runner collection probes sandbox only for known integrated enabled environments", async () => {
  const run = async ({ role, controlFails = false, enabled = true }) => {
    const calls = [], client = {
      capabilities: async () => connection().capabilities,
      authStatus: async () => ({ connected: true }),
      controlStatus: async () => { calls.push("control"); if (controlFails) throw Error("unknown control"); return { ...runner().control.value, role }; },
      environments: async () => [{ key: "dev", name: "Dev", enabled, ready: enabled, sandbox: "workspace-write" }],
      workspaceDiagnostics: async key => { calls.push(`workspace:${key}`); return readyEnvironment.workspace.value; },
      sandboxDiagnostics: async key => { calls.push(`sandbox:${key}`); return readyEnvironment.sandbox.value; },
      jobs: async () => ({ capacity: { maxActive: 1, activeJobId: null }, jobs: [] }),
      authEnvironmentDiagnostics: async () => authEnvironment,
      testCodex: async () => { calls.push("testCodex"); },
      emergencyStop: async () => { calls.push("emergencyStop"); },
      resume: async () => { calls.push("resume"); },
      startJob: async () => { calls.push("startJob"); },
    };
    const result = await collectSafeRunnerDiagnostics({ clientFactory: () => client, logger: () => {} });
    return { calls, result };
  };
  const integrated = await run({ role: "integrated" });
  assert.ok(integrated.calls.includes("sandbox:dev"));
  assert.equal(integrated.result.environments.value[0].sandbox.state, "available");
  const split = await run({ role: "controller" });
  assert.doesNotMatch(JSON.stringify(split.calls), /sandbox|testCodex|emergencyStop|resume|startJob/);
  assert.equal(split.result.environments.value[0].sandbox.state, "not-observed");
  const unknown = await run({ role: "controller", controlFails: true });
  assert.doesNotMatch(JSON.stringify(unknown.calls), /sandbox|testCodex|emergencyStop|resume|startJob/);
  assert.equal(unknown.result.environments.value[0].sandbox.state, "not-observed");
  const disabled = await run({ role: "integrated", enabled: false });
  assert.doesNotMatch(JSON.stringify(disabled.calls), /workspace|sandbox|testCodex|emergencyStop|resume|startJob/);
  assert.equal(disabled.result.environments.value[0].workspace.state, "not-observed");
});

test("capability failure classification preserves protocol response and transport semantics", async () => {
  const collect = async error => collectSafeRunnerDiagnostics({ clientFactory: () => ({ capabilities: async () => { throw error; }, authStatus: async () => { throw Error("must not run"); }, controlStatus: async () => runner().control.value, environments: async () => [], workspaceDiagnostics: async () => { throw Error("unused"); }, sandboxDiagnostics: async () => { throw Error("must not run"); }, jobs: async () => runner().jobs.value, authEnvironmentDiagnostics: async () => authEnvironment }), logger: () => {} });
  const update = await collect(new CodexRunnerError("runner_update_required"));
  let checks = runnerDiagnosticChecks(update);
  assert.equal(update.capabilities.reason, "update-required");
  assert.equal(checks.find(check => check.id === "runner-reachability").status.label, "Available");
  assert.equal(checks.find(check => check.id === "runner-protocol").status.label, "Update required");
  const transport = await collect(new CodexRunnerError("runner_unavailable", "timeout"));
  checks = runnerDiagnosticChecks(transport);
  assert.equal(transport.capabilities.reason, "unreachable");
  assert.equal(checks.find(check => check.id === "runner-reachability").status.label, "Unavailable");
  assert.equal(checks.find(check => check.id === "runner-protocol").status.label, "Unknown");
});
