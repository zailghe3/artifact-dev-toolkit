import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateInfrastructureFreshness,
  infrastructureFreshnessLabel,
  parseInfrastructureFreshnessSnapshot,
} from '../lib/infrastructure-freshness.ts';

const component = (state, deployedRevision = '1'.repeat(40), latestRelevantRevision = deployedRevision) => ({ state, deployedRevision, latestRelevantRevision });
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
});

test('infrastructure freshness labels identify stale components without relying on colour', () => {
  assert.equal(infrastructureFreshnessLabel(snapshot(component('current'), component('current'), component('current'))), 'Infra current');
  assert.equal(infrastructureFreshnessLabel(snapshot(component('current'), component('superseded'), component('superseded'))), 'Update pending · Runtime + Runner');
  assert.equal(infrastructureFreshnessLabel(snapshot(component('unknown'), component('current'), component('current'))), 'Infra freshness unavailable');
});
