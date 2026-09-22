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

test("freshness re-query clears stale snapshot, revisions, copy data, and maintenance", async () => {
  const React = require("react"), renderer = require("react-test-renderer");
  const { ApplicationControlPlaneDiagnostics } = require("../components/ApplicationControlPlaneDiagnostics.tsx");
  const { DiagnosticsMaintenanceProvider, MaintenanceDuePanel } = require("../components/DiagnosticsMaintenance.tsx");
  const current = { state: "current", checkedAt: "2026-09-22T00:00:00.000Z", components: { worker: { state: "current", deployedRevision: "a".repeat(40), sourceHeadRevision: "a".repeat(40) }, runtime: { state: "current" }, runner: { state: "current" } } };
  const superseded = { state: "superseded", checkedAt: "2026-09-22T00:01:00.000Z", components: { ...current.components, worker: { state: "superseded", deployedRevision: "b".repeat(40), sourceHeadRevision: "c".repeat(40) } } };
  const results = [{ status: "loaded", snapshot: current }, { status: "loaded", snapshot: superseded }, { status: "unavailable" }, { status: "loaded", snapshot: superseded }, { status: "loaded", snapshot: current }];
  const queryFreshness = async () => results.shift();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(DiagnosticsMaintenanceProvider, null, React.createElement(MaintenanceDuePanel), React.createElement(ApplicationControlPlaneDiagnostics, { deployment: {}, observedAt: "2026-09-22T00:00:00.000Z", queryFreshness }))); });
  const render = () => JSON.stringify(tree.toJSON()), query = async () => renderer.act(async () => { const button = tree.root.findAllByType("button").find(item => item.props["aria-busy"] !== undefined); await button.props.onClick(); });
  assert.match(render(), /Not queried/); assert.doesNotMatch(render(), /Maintenance due/);
  await query(); assert.match(render(), /Infra current/); assert.doesNotMatch(render(), /Maintenance due/);
  await query(); assert.match(render(), /Update pending.*Worker/); assert.match(render(), /Maintenance due/); assert.match(render(), /bbbbbbbbbbbb/);
  await query(); assert.match(render(), /Freshness unavailable/); assert.doesNotMatch(render(), /Maintenance due|bbbbbbbbbbbb|Component revisions|Update pending/);
  await query(); assert.match(render(), /Maintenance due/);
  await query(); assert.match(render(), /Infra current/); assert.doesNotMatch(render(), /Maintenance due/);
  renderer.act(() => tree.unmount());
});

test("legacy Runner status route preserves query coordinates and targets canonical section", async () => {
  const source = await readFile(new URL("../app/workflows/connections/codex-runner/status/page.tsx", import.meta.url), "utf8");
  assert.match(source, /URLSearchParams/);
  assert.match(source, /\/diagnostics.*#codex-runner/);
});
