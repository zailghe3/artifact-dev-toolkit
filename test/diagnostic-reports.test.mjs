import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticSummary, diagnosticTechnicalDetails } from "../lib/diagnostic-reports.ts";

test("safe diagnostic reports are useful and deterministic", () => {
  const report = { domain: "Codex Runner", observedAt: "2026-09-22T00:00:00.000Z", status: "failed", reasons: ["Emergency stop: active"], technical: { protocol: "compatible", httpStatus: 503, elapsedMs: 12 } };
  assert.match(diagnosticSummary(report), /Codex Runner diagnostics[\s\S]*Emergency stop: active/);
  assert.deepEqual(JSON.parse(diagnosticTechnicalDetails(report)), { schema: "adt.safe-diagnostics.v1", ...report });
});

test("report contract cannot serialize unselected secret-bearing source objects", () => {
  const unsafeSource = { token: "ghp-secret", authorization: "Bearer secret", privateKey: "PRIVATE KEY", safe: { state: "unavailable" } };
  const output = diagnosticTechnicalDetails({ domain: "Authentication", observedAt: "now", status: "failed", technical: { state: unsafeSource.safe.state } });
  assert.doesNotMatch(output, /ghp-secret|Bearer secret|PRIVATE KEY|token|authorization|privateKey/);
  assert.match(output, /unavailable/);
});
