import test from "node:test";
import assert from "node:assert/strict";
import { deriveOperationalDomains, operationalContributors, operationalOverall, runnerDiagnosticChecks, runtimeDiagnosticChecks } from "../lib/operational-diagnostics.ts";

const runtime = (changes = {}) => ({ configured: true, reachable: true, authenticationAccepted: true, protocolCompatible: true, capabilityAvailable: true, wrappingKeyMatches: true, runtimeRevision: "runtime-revision", elapsedMs: 12, ...changes });
const runner = (changes = {}) => ({ state: "connected", label: "Connected to ChatGPT", capabilities: { protocolVersion: 1, runnerVersion: "a".repeat(40), codexAvailable: true, deviceAuth: true, jobExecution: true, releaseMetadata: "current", runnerRevision: 1, codexVersion: "1.2.3" }, compatibility: { protocol: "compatible", runnerRevision: "current", codexVersion: "current" }, auth: { connected: true }, ...changes });
const repository = { identity: { login: "operator", githubId: 42 }, configuration: { backend: "github" }, authorization: { liveState: "authorized" }, installation: { state: "detected" }, permissions: { contentsRead: { effective: true }, contentsWrite: { effective: true } }, repositoryRevision: { state: "available", value: "abc" }, cache: { state: "fresh" }, validation: { state: "valid" } };

test("operational domains group authentication, Artifact Library, Runtime, and Runner facts", () => {
  const domains = deriveOperationalDomains(repository, runtime(), runner(), true);
  assert.deepEqual(domains.map(domain => domain.title), ["Authentication & access", "Artifact Library", "Application / control plane", "ADT Runtime", "Codex Runner"]);
  assert.ok(domains.find(domain => domain.key === "authentication-access").checks.some(check => check.id === "authorization"));
  assert.ok(domains.find(domain => domain.key === "artifact-library").checks.some(check => check.id === "catalogue-cache"));
  assert.ok(domains.find(domain => domain.key === "adt-runtime").checks.some(check => check.id === "runtime-protocol"));
  assert.ok(domains.find(domain => domain.key === "codex-runner").checks.some(check => check.id === "runner-authentication"));
});

test("overall aggregation excludes intentionally unconfigured optional execution boundaries", () => {
  const domains = deriveOperationalDomains(repository, runtime({ configured: false, reachable: false, authenticationAccepted: null, protocolCompatible: false, capabilityAvailable: false, wrappingKeyMatches: false }), { state: "configuration-missing", label: "missing" }, false);
  assert.equal(domains.find(domain => domain.key === "adt-runtime").state, "not-configured");
  assert.equal(domains.find(domain => domain.key === "codex-runner").state, "not-configured");
  assert.equal(operationalOverall(domains).state, "healthy");
  domains.find(domain => domain.key === "artifact-library").state = "degraded";
  assert.equal(operationalOverall(domains).state, "degraded");
  domains.find(domain => domain.key === "authentication-access").state = "failed";
  assert.equal(operationalOverall(domains).state, "failed");
});

test("Runtime prerequisite presentation never turns unverified downstream checks into failures", () => {
  const cases = [
    [runtime({ configured: false }), ["Not configured"]],
    [runtime({ reachable: false, authenticationAccepted: null, protocolCompatible: false, capabilityAvailable: false, wrappingKeyMatches: false }), ["Unavailable", "Not verified", "Not verified", "Not verified", "Not verified"]],
    [runtime({ authenticationAccepted: false, protocolCompatible: false, capabilityAvailable: false, wrappingKeyMatches: false }), ["Rejected", "Not verified", "Not verified", "Not verified"]],
    [runtime({ protocolCompatible: false, capabilityAvailable: false, wrappingKeyMatches: false }), ["Incompatible", "Not verified", "Not verified"]],
    [runtime({ capabilityAvailable: false, wrappingKeyMatches: false }), ["Unavailable", "Not verified"]],
    [runtime({ wrappingKeyMatches: false }), ["Mismatch"]],
    [runtime(), ["Compatible"]],
  ];
  for (const [input, expectedLabels] of cases) {
    const labels = runtimeDiagnosticChecks(input).map(check => check.status.label);
    for (const label of expectedLabels) assert.ok(labels.includes(label), `${label} in ${labels.join(", ")}`);
  }
});

test("Runner presentation distinguishes missing, unavailable, incompatible, disconnected, and connected states", () => {
  assert.equal(runnerDiagnosticChecks({ state: "configuration-missing", label: "missing" })[0].status.label, "Not configured");
  assert.ok(runnerDiagnosticChecks({ state: "unavailable", label: "unavailable" }).some(check => check.status.label === "Unavailable"));
  assert.ok(runnerDiagnosticChecks({ state: "update-required", label: "update" }).some(check => check.status.label === "Update required"));
  assert.equal(runnerDiagnosticChecks(runner({ state: "disconnected", auth: { connected: false } })).find(check => check.id === "runner-authentication").status.label, "Disconnected");
  assert.equal(runnerDiagnosticChecks(runner()).find(check => check.id === "runner-authentication").status.label, "Connected");
});

test("needs-attention links are exact, bounded, and exclude optional missing boundaries", () => {
  const domains = deriveOperationalDomains(null, runtime({ reachable: false, authenticationAccepted: null, protocolCompatible: false, capabilityAvailable: false, wrappingKeyMatches: false }), { state: "unavailable", label: "unavailable" }, false);
  const result = operationalContributors(domains, 3);
  assert.equal(result.contributors.length, 3);
  assert.ok(result.omittedCount > 0);
  assert.ok(result.contributors.every(item => item.href.startsWith("#") && !item.message.includes("secret")));
  const healthy = deriveOperationalDomains(repository, runtime({ configured: false }), { state: "configuration-missing", label: "missing" }, false);
  assert.deepEqual(operationalContributors(healthy), { contributors: [], omittedCount: 0 });
});

test("presentation models contain no private Runner or secret inputs", () => {
  const input = runner();
  input.privatePath = "/private/workspace";
  input.token = "provider-secret";
  const serialized = JSON.stringify(runnerDiagnosticChecks(input));
  assert.doesNotMatch(serialized, /private\/workspace|provider-secret|token/);
});
