import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { installTsxHook } from './render-tsx.mjs';

const require = installTsxHook();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let refreshRunner, refreshRuntime, refreshRepository;
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === '@/app/(application)/diagnostics/actions') return {
    refreshRunnerObservation: () => refreshRunner(),
    refreshRuntimeObservation: () => refreshRuntime(),
    refreshRepositoryObservation: () => refreshRepository(),
  };
  return load.call(this, name, ...args);
};
const { ArtifactLibraryDomain, AuthenticationDomain, DiagnosticsOverall, RunnerDomain, RuntimeDomain } = require('../components/DiagnosticsDomains.tsx');
const { DiagnosticsObservations } = require('../components/DiagnosticsObservations.tsx');
const { RuntimeDiagnosticProvider } = require('../components/ADTRuntimeExecutionPathDiagnostic.tsx');
Module._load = load;

const time = '2026-11-26T12:00:00.000Z';
const later = '2026-11-26T12:01:00.000Z';
const control = (emergencyStopped, updatedAt = time) => ({
  emergencyStopped, updatedAt, hardRestart: { attempted: false, succeeded: false }, role: 'controller',
  executor: { healthy: true, generation: 'executor', activeExecutionId: null, activity: null, boundary: 'container' },
});
const unavailable = { state: 'unavailable' };
const available = value => ({ state: 'available', value });
const capabilities = { protocolVersion: 1, runnerVersion: 'a'.repeat(40), codexAvailable: true,
  deviceAuth: true, jobExecution: true, releaseMetadata: 'current', runnerRevision: 1, codexVersion: '1.2.3' };
const runner = value => ({
  connection: { state: 'connected', label: 'Connected', capabilities,
    compatibility: { protocol: 'compatible', runnerRevision: 'current', codexVersion: 'current' } },
  capabilities: available(capabilities), authentication: available({ connected: true }),
  control: value ? available(value) : unavailable,
  environments: available([{ environment: { key: 'fixture', name: 'Fixture', enabled: true, ready: true },
    workspace: { state: 'not-observed' }, sandbox: { state: 'not-observed' } }]),
  jobs: { state: 'not-observed' }, authEnvironment: { state: 'not-observed' },
});
const observe = (value, observedAt = time) => ({ observedAt, value });
const repository = {
  generatedAt: time, identity: { login: 'fixture', githubId: 42 },
  configuration: { backend: 'github', owner: 'fixture', repository: 'artifacts', branch: 'main', artifactRoot: 'artifacts',
    cacheBinding: 'configured', authSecrets: { GITHUB_APP_ID: 'configured', GITHUB_APP_CLIENT_ID: 'configured',
      GITHUB_APP_CLIENT_SECRET: 'configured', GITHUB_APP_PRIVATE_KEY: 'configured', SESSION_SECRET: 'configured' } },
  authorization: { repositoryMatches: true, liveState: 'authorized' }, installation: { state: 'detected' },
  permissions: { contentsRead: { effective: true, reason: 'granted' }, contentsWrite: { effective: true, reason: 'granted' } },
  repositoryRevision: { state: 'available', value: 'b'.repeat(40) }, cache: { state: 'fresh' }, validation: { state: 'not_run' },
};
const runtime = {
  configured: true, reachable: true, readinessAccepted: true, authenticationAccepted: true,
  protocolCompatible: true, capabilityAvailable: true, graphCapabilityAvailable: true, wrappingKeyMatches: true,
  adrianSecurityCapabilityAvailable: false, adrianSecurityTestCapabilityAvailable: false,
  runtimeRevision: 'c'.repeat(40), elapsedMs: 5,
};

const content = children => React.Children.toArray(children).map(child =>
  React.isValidElement(child) ? content(child.props.children) : String(child)).join('');

function button(node, name) {
  const match = node.findAllByType('button').find(item => content(item.props.children) === name);
  assert.ok(match, `Missing button ${name}`);
  return match;
}
const section = (tree, heading) => tree.root.findByProps({ 'aria-labelledby': heading });
const runnerSection = tree => section(tree, 'codex-runner-heading');
const runtimeSection = tree => section(tree, 'adt-runtime-heading');
const overall = tree => section(tree, 'overall-heading');

async function click(node, name) {
  await act(async () => { button(node, name).props.onClick(); });
}
function expectControls(tree, stop, resume) {
  assert.equal(!button(runnerSection(tree), 'Emergency Stop Runner').props.disabled, stop);
  assert.equal(!button(runnerSection(tree), 'Resume Runner').props.disabled, resume);
}
function visibleText(node) {
  if (typeof node === 'string') return node;
  if (node.props['aria-hidden'] === 'true' || node.props.className === 'sr-only') return '';
  return node.children.map(visibleText).join('');
}
function matchingText(node, expected) {
  return node.findAll(item => typeof item.type === 'string' && (typeof expected === 'string'
    ? visibleText(item) === expected : expected.test(visibleText(item))));
}
function has(node, text) {
  assert.ok(matchingText(node, text).length, `Missing text ${text}`);
}
function lacks(node, text) {
  assert.equal(matchingText(node, text).length, 0, `Unexpected text ${text}`);
}

async function mount(t, initialControl, { repositoryResult = repository } = {}) {
  const observations = {
    runner: Promise.resolve(observe(runner(initialControl))),
    runtime: Promise.resolve(observe(runtime)),
    repository: Promise.resolve(observe(repositoryResult)),
  };
  const authentication = Promise.resolve(observe(repository));
  const props = { observations, authentication, deploymentConfigured: true };
  let tree;
  await act(async () => {
    tree = create(React.createElement(DiagnosticsObservations, null,
      React.createElement(RuntimeDiagnosticProvider, null,
        React.createElement(DiagnosticsOverall, props),
        React.createElement(AuthenticationDomain, { initial: authentication }),
        React.createElement(ArtifactLibraryDomain, { initial: observations.repository }),
        React.createElement(RuntimeDomain, { initial: observations.runtime }),
        React.createElement(RunnerDomain, { initial: observations.runner }),
      ),
    ));
  });
  t.after(() => act(() => tree.unmount()));
  return tree;
}

function mockFetch(t, handle) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    return handle(url, init);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

function clipboard(t) {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const copies = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => copies.push(JSON.parse(value)) } });
  t.after(() => {
    if (previous) Object.defineProperty(navigator, 'clipboard', previous);
    else delete navigator.clipboard;
  });
  return copies;
}

test('passive Runner refreshes reconcile external stop, resume, and a structured unavailable control observation', async t => {
  const calls = mockFetch(t, () => assert.fail('passive refresh should not call browser diagnostic or mutation endpoints'));
  const copies = clipboard(t);
  const tree = await mount(t, control(false));
  expectControls(tree, true, false);
  has(runnerSection(tree), 'Runner operational readinessReady');
  assert.deepEqual(calls, []);

  const pending = Promise.withResolvers();
  let passiveReads = 0;
  refreshRunner = () => { passiveReads++; return pending.promise; };
  await click(runnerSection(tree), 'Refresh observation');
  has(overall(tree), 'Waiting for required observations.');
  has(runtimeSection(tree), 'Test execution path');
  has(section(tree, 'artifact-library-heading'), 'Catalogue health');
  assert.equal(passiveReads, 1);
  await act(async () => { pending.resolve(observe(runner(control(true, later)), later)); });
  expectControls(tree, false, true);
  has(runnerSection(tree), 'Needs attention');
  has(overall(tree), 'Codex Runner: Emergency-stop latch is active.');
  await click(runnerSection(tree), 'Copy technical details');
  assert.deepEqual([copies.at(-1).status, copies.at(-1).technical.emergencyStop, copies.at(-1).technical.controlObservedAt], ['failed', true, later]);

  refreshRunner = async () => observe(runner(control(false, later)), later);
  await click(runnerSection(tree), 'Refresh observation');
  expectControls(tree, true, false);
  has(runnerSection(tree), 'Runner operational readinessReady');
  lacks(overall(tree), 'Codex Runner: Emergency-stop latch is active.');

  refreshRunner = async () => observe(runner(null), later);
  await click(runnerSection(tree), 'Refresh observation');
  expectControls(tree, false, false);
  has(runnerSection(tree), /^Last confirmed emergency stop was clear at .+This observation is historical\.$/);
  await click(runnerSection(tree), 'Copy technical details');
  assert.equal(copies.at(-1).status, 'degraded');
  assert.equal(copies.at(-1).technical.emergencyStop, 'unknown');
  assert.equal(copies.at(-1).technical.executorHealthy, 'unknown');
  assert.equal(copies.at(-1).technical.controlObservedAt, undefined);
  assert.deepEqual(calls, []);
});

test('an initially unavailable observation becomes actionable after a later confirmation', async t => {
  const tree = await mount(t, null);
  expectControls(tree, false, false);
  refreshRunner = async () => observe(runner(control(true, later)), later);
  await click(runnerSection(tree), 'Refresh observation');
  expectControls(tree, false, true);

  refreshRunner = async () => { throw new Error('Runner observation failed'); };
  await click(runnerSection(tree), 'Refresh observation');
  expectControls(tree, false, false);
  has(runnerSection(tree), /^Last confirmed emergency stop was active at .+This observation is historical\.$/);
  has(runnerSection(tree), 'Retry observation');
});

test('older passive and optional reads cannot replace a confirmed stop or resume', async t => {
  let confirmed = false;
  const original = globalThis.confirm;
  globalThis.confirm = () => confirmed;
  t.after(() => { globalThis.confirm = original; });
  const copies = clipboard(t);
  const pendingStop = Promise.withResolvers();
  const pendingResume = Promise.withResolvers();
  const pendingDetail = Promise.withResolvers();
  const pendingPassive = Promise.withResolvers();
  const calls = mockFetch(t, async (url, init) => {
    if (url.endsWith('/workspaces')) return Response.json({ workspaces: [] });
    if (url.endsWith('/jobs')) return Response.json({ capacity: { maxActive: 1, activeJobId: null }, jobs: [] });
    if (url.endsWith('/control') && !init.method) return pendingDetail.promise;
    if (url.endsWith('/control') && JSON.parse(init.body).action === 'emergency-stop') return pendingStop.promise;
    if (url.endsWith('/control') && JSON.parse(init.body).action === 'resume') return pendingResume.promise;
    assert.fail(`Unexpected request ${url}`);
  });
  const tree = await mount(t, control(false));
  await click(runnerSection(tree), 'Emergency Stop Runner');
  assert.equal(calls.length, 0, 'cancelling confirmation sends no mutation');
  await click(runnerSection(tree), 'Query operational details');
  refreshRunner = () => pendingPassive.promise;
  await click(runnerSection(tree), 'Refresh observation');

  confirmed = true;
  await click(runnerSection(tree), 'Emergency Stop Runner');
  assert.equal(button(runnerSection(tree), 'Stopping…').props.disabled, true);
  assert.equal(button(runnerSection(tree), 'Resume Runner').props.disabled, true);
  has(overall(tree), 'Waiting for required observations.');
  await act(async () => { pendingStop.resolve(Response.json(control(true, later))); });
  await act(async () => {
    pendingPassive.resolve(observe(runner(control(false)), later));
    pendingDetail.resolve(Response.json(control(false)));
  });
  expectControls(tree, false, true);
  has(overall(tree), 'Codex Runner: Emergency-stop latch is active.');
  await click(runnerSection(tree), 'Copy technical details');
  assert.equal(copies.at(-1).technical.emergencyStop, true);
  assert.equal(copies.at(-1).technical.executorHealthy, 'unknown', 'pre-restart executor cannot be confirmed by a stop response');

  const duringResume = Promise.withResolvers();
  refreshRunner = () => duringResume.promise;
  await click(runnerSection(tree), 'Resume Runner');
  await click(runnerSection(tree), 'Refresh observation');
  await act(async () => { pendingResume.resolve(Response.json(control(false, later))); });
  await act(async () => { duringResume.resolve(observe(runner(control(true)), later)); });
  expectControls(tree, true, false);

  refreshRunner = async () => observe(runner(control(true, later)), later);
  await click(runnerSection(tree), 'Refresh observation');
  expectControls(tree, false, true);
  assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => JSON.parse(call.body).action), ['emergency-stop', 'resume']);
});

test('failed mutations remain uncertain through failed rechecks and optional control can reconcile despite a workspace failure', async t => {
  let detail = new Response(null, { status: 503 });
  const calls = mockFetch(t, async (url, init) => {
    if (url.endsWith('/workspaces') || init?.method === 'POST') return new Response(null, { status: 503 });
    if (url.endsWith('/control')) return detail.clone();
    assert.fail(`Unexpected request ${url}`);
  });
  const tree = await mount(t, control(true));
  await click(runnerSection(tree), 'Resume Runner');
  expectControls(tree, false, false);
  has(runnerSection(tree), 'The control operation outcome is unknown. Refresh the Runner observation or query operational details to verify the current state.');
  await click(runnerSection(tree), 'Query operational details');
  expectControls(tree, false, false);
  has(runnerSection(tree), 'The control operation outcome is unknown. Refresh the Runner observation or query operational details to verify the current state.');
  detail = Response.json(control(false, later));
  await click(runnerSection(tree), 'Query operational details');
  expectControls(tree, true, false);
  has(runnerSection(tree), 'Runner operational readinessReady');
  has(runnerSection(tree), 'Optional Runner workspace details are unavailable.');
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('an older passive completion cannot replace a newer optional control observation', async t => {
  const earlier = Promise.withResolvers();
  refreshRunner = () => earlier.promise;
  mockFetch(t, async url => url.endsWith('/control') ? Response.json(control(true, later)) : Response.json({ workspaces: [] }));
  const tree = await mount(t, control(false));
  await click(runnerSection(tree), 'Refresh observation');
  await click(runnerSection(tree), 'Query operational details');
  await act(async () => { earlier.resolve(observe(runner(control(false)), later)); });
  expectControls(tree, false, true);
});

test('failed Runtime readiness refreshes keep old ready evidence out of the panel and copy report', async t => {
  mockFetch(t, () => assert.fail('no automatic active diagnostics'));
  const copies = clipboard(t);
  const tree = await mount(t, control(false));
  refreshRuntime = async () => observe(null, later);
  await click(runtimeSection(tree), 'Refresh observation');
  has(runtimeSection(tree), 'Needs attention');
  lacks(runtimeSection(tree), 'Readiness details');
  await click(runtimeSection(tree), 'Copy technical details');
  assert.equal(copies.at(-1).status, 'failed');
  assert.equal(copies.at(-1).observedAt, later);
  assert.equal(copies.at(-1).technical.infrastructureReadiness, 'unavailable');
  assert.equal(copies.at(-1).technical.runtimeRevision, undefined);
});

test('the independently confirmed authorization remains available when the initial catalogue fails', async t => {
  const tree = await mount(t, control(false), { repositoryResult: null });
  has(section(tree, 'authentication-access-heading'), 'Healthy');
  has(section(tree, 'artifact-library-heading'), 'Needs attention');
  has(overall(tree), 'Artifact Library: Artifact Library diagnostics is unavailable.');
  lacks(overall(tree), 'Authentication & access: Authentication diagnostics is unavailable.');
});

test('a delayed active Runtime response cannot re-verify an earlier readiness observation', async t => {
  const active = Promise.withResolvers();
  const calls = mockFetch(t, () => active.promise);
  const copies = clipboard(t);
  const tree = await mount(t, control(false));
  await click(runtimeSection(tree), 'Test execution path');
  refreshRuntime = async () => observe({ ...runtime, runtimeRevision: 'd'.repeat(40) }, later);
  await click(runtimeSection(tree), 'Refresh observation');
  const probe = { requestId: 'd'.repeat(32), stage: 'complete', result: 'ok', authenticated: true,
    protocolCompatible: true, noncePersisted: true, accepted: true, dispatched: true, elapsedMs: 5 };
  const dependencies = Object.fromEntries(['postgres', 'checkpoints', 'workflow', 'broker'].map(key => [key, { status: 'available' }]));
  await act(async () => { active.resolve(Response.json({ schema: 'adt.runtime-management.v1', management: probe, workflowHistory: probe, dependencies })); });
  has(runtimeSection(tree), 'The previous management check belongs to an earlier Runtime observation. Test the execution path to verify it again.');
  await click(runtimeSection(tree), 'Copy technical details');
  assert.equal(copies.at(-1).technical.runtimeRevision, 'd'.repeat(40));
  assert.equal(copies.at(-1).technical.workflowStorageReadiness, 'not_verified');
  assert.equal(copies.at(-1).technical.managementDiagnostic, undefined);
  assert.equal(calls.length, 1);
});

test('a failed catalogue refresh retires old validation controls and copy evidence', async t => {
  const tree = await mount(t, control(false));
  const library = section(tree, 'artifact-library-heading');
  has(library, 'Validate artifacts');
  refreshRepository = async () => observe(null, later);
  await click(library, 'Refresh observation');
  const current = section(tree, 'artifact-library-heading');
  has(current, 'Needs attention');
  lacks(current, 'Validate artifacts');
  lacks(current, 'Copy technical details');
  has(current, 'Retry observation');
});
