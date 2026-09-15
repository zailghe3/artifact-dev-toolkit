import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateInfrastructureFreshness,
  infrastructureFreshnessLabel,
  infrastructureRevisionLabel,
  parseInfrastructureFreshnessSnapshot,
} from '../lib/infrastructure-freshness.ts';
import { collectInfrastructureFreshness } from '../lib/infrastructure-freshness-service.ts';

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
  assert.equal(infrastructureFreshnessLabel(snapshot(component('current'), component('superseded'), component('superseded'))), 'Update pending · Runtime + Runner');
  assert.equal(infrastructureFreshnessLabel(snapshot(component('unknown'), component('current'), component('current'))), 'Infra freshness unavailable');
  assert.equal(infrastructureFreshnessLabel(snapshot(component('current'), component('superseded'), component('unknown'))), 'Update pending · Runtime · Unknown: Runner');
});

test('infrastructure revision label exposes short Runtime and Runner build identities', () => {
  const value = snapshot(component('current', '1'.repeat(40)), component('current', 'abcdef0' + '1'.repeat(33)), component('current', '7654321' + '2'.repeat(33)));
  assert.equal(infrastructureRevisionLabel(value), 'Runtime abcdef0 · Runner 7654321');
  value.components.runner = { state: 'unknown' };
  assert.equal(infrastructureRevisionLabel(value), 'Runtime abcdef0 · Runner ?');
});

test('freshness collection keeps confirmed component results when another probe fails', async () => {
  const workerRevision = '1'.repeat(40), runtimeRevision = '2'.repeat(40), sourceHead = '3'.repeat(40);
  const result = await collectInfrastructureFreshness({
    workerRevision,
    runtimeRevision: async () => runtimeRevision,
    runnerRevision: async () => { throw new Error('runner unavailable'); },
    resolveRevisionFreshness: async (kind) => kind === 'runtime'
      ? { state: 'superseded', sourceHeadRevision: sourceHead }
      : { state: 'current', sourceHeadRevision: sourceHead },
    now: () => new Date('2026-09-15T20:00:00.000Z'),
  });
  assert.equal(result.state, 'superseded');
  assert.deepEqual(result.components.worker, { state: 'current', deployedRevision: workerRevision, sourceHeadRevision: sourceHead });
  assert.deepEqual(result.components.runtime, { state: 'superseded', deployedRevision: runtimeRevision, sourceHeadRevision: sourceHead });
  assert.deepEqual(result.components.runner, { state: 'unknown' });
  assert.equal(infrastructureFreshnessLabel(result), 'Update pending · Runtime · Unknown: Runner');
});

test('freshness collection deadline degrades a hung component without delaying confirmed results indefinitely', async () => {
  const revision = '4'.repeat(40), sourceHead = '5'.repeat(40), started = Date.now();
  const result = await collectInfrastructureFreshness({
    workerRevision: revision,
    runtimeRevision: async () => revision,
    runnerRevision: async () => new Promise(() => {}),
    resolveRevisionFreshness: async () => ({ state: 'current', sourceHeadRevision: sourceHead }),
    timeoutMs: 250,
  });
  assert.ok(Date.now() - started < 1_000);
  assert.equal(result.state, 'unknown');
  assert.equal(result.components.worker.state, 'current');
  assert.equal(result.components.runtime.state, 'current');
  assert.equal(result.components.runner.state, 'unknown');
});
