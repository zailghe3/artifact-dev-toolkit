import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installTsxHook } from "./render-tsx.mjs";
const require = installTsxHook();

test("ordinary diagnostics skips validation while explicit query participates in server health", async () => {
  const page = await readFile(new URL("../app/diagnostics/page.tsx", import.meta.url), "utf8");
  assert.match(page, /validationRequested = query\.validation === "run"/);
  assert.match(page, /includeValidation: validationRequested/);
  assert.match(page, /deriveOperationalDomains\(repository/);
  assert.match(page, /repository\.validation\.errors/);
  assert.match(page, /omittedErrorCount/);
});

test("Artifact validation action explicitly navigates to the health-recomputing mode", async () => {
  const source = await readFile(new URL("../components/ArtifactValidationAction.tsx", import.meta.url), "utf8");
  assert.match(source, /next\.set\("validation", "run"\)/);
  assert.match(source, /router\.push\(`\/diagnostics/);
  assert.doesNotMatch(source, /useEffect|fetch\(/);
});

test("control-plane diagnostics uses the canonical bounded freshness parser and endpoint", async () => {
  const source = await readFile(new URL("../components/ApplicationControlPlaneDiagnostics.tsx", import.meta.url), "utf8");
  const shared = await readFile(new URL("../components/InfrastructureFreshnessIndicator.tsx", import.meta.url), "utf8");
  assert.match(shared, /\/api\/infrastructure-freshness/);
  assert.match(shared, /parseInfrastructureFreshnessSnapshot/);
  assert.match(source, /queryInfrastructureFreshness/);
  assert.match(source, /infrastructureFreshnessLabel/);
  assert.match(source, /application-control-plane/);
  assert.doesNotMatch(source, /github\.com\/compare|compareCommits|evaluateRunnerCompatibility/);
});

test("Maintenance due includes only confirmed component-aware supersession", () => {
  const { infrastructureMaintenanceItem } = require("../components/DiagnosticsMaintenance.tsx");
  const components = { worker: { state: "current", deployedRevision: "a".repeat(40), sourceHeadRevision: "a".repeat(40) }, runtime: { state: "current" }, runner: { state: "current" } };
  assert.equal(infrastructureMaintenanceItem(), undefined);
  assert.equal(infrastructureMaintenanceItem({ state: "current", checkedAt: "2026-09-22T00:00:00.000Z", components }), undefined);
  assert.equal(infrastructureMaintenanceItem({ state: "unknown", checkedAt: "2026-09-22T00:00:00.000Z", components: { ...components, runtime: { state: "unknown" } } }), undefined);
  const item = infrastructureMaintenanceItem({ state: "superseded", checkedAt: "2026-09-22T00:00:00.000Z", components: { ...components, worker: { state: "superseded", deployedRevision: "a".repeat(40), sourceHeadRevision: "b".repeat(40) }, runtime: { state: "unknown" } } });
  assert.equal(item.href, "#application-control-plane");
  assert.match(item.message, /Update pending · Worker · Unknown: Runtime/);
});

test("page-level Maintenance due is wired to the on-demand freshness result", async () => {
  const page = await readFile(new URL("../app/diagnostics/page.tsx", import.meta.url), "utf8"), control = await readFile(new URL("../components/ApplicationControlPlaneDiagnostics.tsx", import.meta.url), "utf8");
  assert.match(page, /DiagnosticsMaintenanceProvider/);
  assert.match(page, /MaintenanceDuePanel/);
  assert.match(control, /setInfrastructureMaintenance\(infrastructureMaintenanceItem\(result\.snapshot\)\)/);
  assert.doesNotMatch(control, /useEffect/);
});

test("legacy Runner status route preserves query coordinates and targets canonical section", async () => {
  const source = await readFile(new URL("../app/workflows/connections/codex-runner/status/page.tsx", import.meta.url), "utf8");
  assert.match(source, /URLSearchParams/);
  assert.match(source, /\/diagnostics.*#codex-runner/);
});
