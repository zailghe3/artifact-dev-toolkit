import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateInfrastructureFreshness,
  infrastructureFreshnessLabel,
  infrastructureRevisionLabel,
  parseInfrastructureFreshnessSnapshot,
  INFRASTRUCTURE_FRESHNESS_CLIENT_TIMEOUT_MS,
  INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS,
} from '../lib/infrastructure-freshness.ts';
import { collectInfrastructureFreshness } from '../lib/infrastructure-freshness-service.ts';
import { resolveComponentFreshness } from '../lib/deployment-freshness-resolution.ts';

const component = (state, deployedRevision = '1'.repeat(40), sourceHeadRevision = deployedRevision) => ({ state, deployedRevision, sourceHeadRevision });
const snapshot = (worker, runtime, runner) => ({
  state: aggregateInfrastructureFreshness({ worker, runtime, runner }),
  checkedAt: '2026-09-15T20:00:00.000Z',
  components: { worker, runtime, runner },
});

test('infrastructure freshness aggregate gives superseded precedence over unknown', () => {
  assert.equal(aggregateInfrastructureFreshness({ worker: component('current'), runtime: component('superseded'), runner: component('unknown') }), 'superseded');
  assert.equal(aggregateInfrastructureFreshness({ worker: component('current'), runtime: component('current'), runner: component('unknown') }), 'unknown');
  assert.equal(aggregateInfrastructureFreshness({ worker: component('current'), runtime: component('current'), runner: component('current') }), 'current');
});

test('infrastructure freshness parser accepts only internally consistent bounded snapshots', () => {
  const value = snapshot(component('current'), component('superseded', '2'.repeat(40), '3'.repeat(40)), component('current'));
  assert.deepEqual(parseInfrastructureFreshnessSnapshot(value), value);
  assert.equal(parseInfrastructureFreshnessSnapshot({ ...value, state: 'current' }), undefined);
  assert.equal(parseInfrastructureFreshnessSnapshot({ ...value, extra: true }), undefined);
  assert.equal(parseInfrastructureFreshnessSnapshot({ ...value, components: { ...value.components, runtime: { ...value.components.runtime, deployedRevision: 'not-a-sha' } } }), undefined);
  assert.equal(parseInfrastructureFreshnessSnapshot({ ...value, components: { ...value.components, runtime: { ...value.components.runtime, sourceHeadRevision: 'not-a-sha' } } }), undefined);
  assert.equal(parseInfrastructureFreshnessSnapshot({ ...value, components: { ...value.components, runtime: { ...value.components.runtime, latestRelevantRevision: '3'.repeat(40) } } }), undefined);
});

test('infrastructure freshness labels identify stale and uncertain components without relying on colour', () => {
  assert.equal(infrastructureFreshnessLabel(snapshot(component('current'), component('current'), component('current'))), 'Infra current');
  assert.equal(infrastructureFreshnessLabel(snapshot(component('current'), component('current'), component('superseded'))), 'Runner update available');
  assert.equal(infrastructureFreshnessLabel(snapshot(component('current'), component('superseded'), component('current'))), 'Runtime update available');
  assert.equal(infrastructureFreshnessLabel(snapshot(component('superseded'), component('current'), component('current'))), 'App update available');
  assert.equal(infrastructureFreshnessLabel(snapshot(component('current'), component('superseded'), component('superseded'))), 'Updates available · Runtime + Runner');
  assert.equal(infrastructureFreshnessLabel(snapshot(component('unknown'), component('current'), component('current'))), 'Infrastructure freshness unavailable');
  assert.equal(infrastructureFreshnessLabel(snapshot(component('unknown'), component('unknown'), component('superseded'))), 'Runner update available');
});

test('infrastructure revision label exposes short Runtime and Runner build identities', () => {
  const value = snapshot(component('current', '1'.repeat(40)), component('current', 'abcdef0' + '1'.repeat(33)), component('current', '7654321' + '2'.repeat(33)));
  assert.equal(infrastructureRevisionLabel(value), 'Runtime abcdef0 · Runner 7654321');
  value.components.runner = { state: 'unknown' };
  assert.equal(infrastructureRevisionLabel(value), 'Runtime abcdef0');
});

test('freshness collection keeps confirmed component results when another probe fails', async () => {
  const workerRevision = '1'.repeat(40), runtimeRevision = '2'.repeat(40), sourceHead = '3'.repeat(40);
  const result = await collectInfrastructureFreshness({
    workerRevision,
    runtimeRevision: async () => runtimeRevision,
    runnerFreshness: async () => { throw new Error('runner unavailable'); },
    resolveRevisionFreshness: async (kind) => kind === 'runtime'
      ? { state: 'superseded', sourceHeadRevision: sourceHead }
      : { state: 'current', sourceHeadRevision: sourceHead },
    now: () => new Date('2026-09-15T20:00:00.000Z'),
  });
  assert.equal(result.state, 'superseded');
  assert.deepEqual(result.components.worker, { state: 'current', deployedRevision: workerRevision, sourceHeadRevision: sourceHead });
  assert.deepEqual(result.components.runtime, { state: 'superseded', deployedRevision: runtimeRevision, sourceHeadRevision: sourceHead });
  assert.deepEqual(result.components.runner, { state: 'unknown' });
  assert.equal(infrastructureFreshnessLabel(result), 'Runtime update available');
});

test('freshness collection deadline degrades a hung component without delaying confirmed results indefinitely', async () => {
  const revision = '4'.repeat(40), sourceHead = '5'.repeat(40), started = Date.now();
  const result = await collectInfrastructureFreshness({
    workerRevision: revision,
    runtimeRevision: async () => revision,
    runnerFreshness: async () => new Promise(() => {}),
    resolveRevisionFreshness: async () => ({ state: 'current', sourceHeadRevision: sourceHead }),
    timeoutMs: 250,
  });
  assert.ok(Date.now() - started < 1_000);
  assert.equal(result.state, 'unknown');
  assert.equal(result.components.worker.state, 'current');
  assert.equal(result.components.runtime.state, 'current');
  assert.equal(result.components.runner.state, 'unknown');
});

test('Runner compatibility freshness bypasses GitHub comparison and outranks an unrelated unknown', async () => {
  const runnerBuild = 'b'.repeat(40);
  const compared = [];
  const result = await collectInfrastructureFreshness({
    runtimeRevision: async () => undefined,
    runnerFreshness: async () => ({ state: 'superseded', deployedRevision: runnerBuild }),
    resolveRevisionFreshness: async (component) => { compared.push(component); return { state: 'current' }; },
  });
  assert.equal(result.state, 'superseded');
  assert.deepEqual(result.components.runner, { state: 'superseded', deployedRevision: runnerBuild });
  assert.deepEqual(compared, []);
  assert.equal(infrastructureFreshnessLabel(result), 'Runner update available');
  assert.match(infrastructureRevisionLabel(result), /Runner bbbbbbb/);
});

test('client freshness timeout leaves a response margin above bounded server collection', () => {
  assert.ok(INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS >= 3_000);
  assert.ok(INFRASTRUCTURE_FRESHNESS_CLIENT_TIMEOUT_MS - INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS >= 1_000);
});

test('matching Runner compatibility is current without a GitHub comparison', async () => {
  const revision = 'a'.repeat(40);
  let runnerCompared = false;
  const result = await collectInfrastructureFreshness({
    workerRevision: revision,
    runtimeRevision: async () => revision,
    runnerFreshness: async () => ({ state: 'current', deployedRevision: 'c'.repeat(40) }),
    resolveRevisionFreshness: async (component) => {
      if (component === 'runner') runnerCompared = true;
      return { state: 'current', sourceHeadRevision: revision };
    },
  });
  assert.equal(result.components.runner.state, 'current');
  assert.equal(result.state, 'current');
  assert.equal(runnerCompared, false);
});

test('production regression resolves current Worker and Runtime while reporting the Runner update', async () => {
  const head = '22fc4bfb50e7c7a68e1a65cb97d8d7ba17744331';
  const runtimeRevision = 'b7b1ce84a08e065bb998c02838d17f0264dfcbe2';
  const runnerRevision = 'b70d7ff000000000000000000000000000000000';
  const comparison = { status: 'ahead', head_commit: { sha: head }, files: [{ filename: 'components/DeploymentFooter.tsx' }] };
  const result = await collectInfrastructureFreshness({
    workerRevision: head,
    runtimeRevision: async () => runtimeRevision,
    runnerFreshness: async () => ({ state: 'superseded', deployedRevision: runnerRevision }),
    resolveRevisionFreshness: (component, deployed) => resolveComponentFreshness(component, deployed, head, async () => comparison),
  });
  assert.deepEqual(
    [result.components.worker.state, result.components.runtime.state, result.components.runner.state],
    ['current', 'current', 'superseded'],
  );
  assert.equal(infrastructureFreshnessLabel(result), 'Runner update available');
});
