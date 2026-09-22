import test from "node:test";
import assert from "node:assert/strict";
import { buildDiagnosticReport } from "../lib/diagnostic-reports.ts";

const runner = { domain: "codex-runner", observedAt: "2026-09-22T00:00:00.000Z", state: "failed", connection: "connected", protocol: "compatible", runnerRelease: "current", codexVersion: "current", runnerBuild: "a".repeat(40), emergencyStop: true, executorHealthy: false };
test("domain report builder emits deterministic safe summary and technical fields", () => {
  const report = buildDiagnosticReport(runner);
  assert.match(report.summary, /Codex Runner diagnostics[\s\S]*Emergency stop is active/);
  const parsed = JSON.parse(report.technical);
  assert.equal(parsed.schema, "adt.safe-diagnostics.v1");
  assert.deepEqual(Object.keys(parsed.technical).sort(), ["codexVersion", "connection", "emergencyStop", "executorHealthy", "protocol", "runnerBuild", "runnerRelease"]);
});

test("report boundary rejects every representative secret-bearing or arbitrary field", () => {
  for (const unsafe of [
    { token: "ghp-secret" }, { accessToken: "secret" }, { authorization: "Bearer secret" }, { privateKey: "PRIVATE KEY" },
    { cfAccessClientSecret: "secret" }, { runnerSharedSecret: "secret" }, { cookie: "session=secret" },
    { environment: { SESSION_SECRET: "secret" } }, { upstreamError: { body: "arbitrary" } },
  ]) assert.throws(() => buildDiagnosticReport({ ...runner, ...unsafe }), /unrecognized|invalid/i);
});

test("summary reasons are derived from allow-listed states rather than caller text", () => {
  assert.throws(() => buildDiagnosticReport({ ...runner, reasons: ["Bearer secret"] }), /unrecognized/i);
  assert.doesNotMatch(buildDiagnosticReport(runner).summary, /Bearer|secret/i);
});

test("artifact report represents queried validation outcomes", () => {
  const base = { domain: "artifact-library", observedAt: "2026-09-22T00:00:00.000Z", state: "healthy", repository: "acme/artifacts", branch: "main", catalogue: "fresh", validationCodes: [] };
  assert.match(buildDiagnosticReport({ ...base, validation: "valid" }).technical, /"validation": "valid"/);
  assert.match(buildDiagnosticReport({ ...base, state: "failed", validation: "invalid", invalidCount: 1, validationCodes: ["invalid_frontmatter"] }).summary, /Artifact validation: invalid/);
  assert.match(buildDiagnosticReport({ ...base, state: "degraded", validation: "unavailable" }).summary, /Artifact validation: unavailable/);
});
