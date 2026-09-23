import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deploymentComponentImpact,
  hasUnclassifiedDeploymentChanges,
} from '../lib/deployment-component-impact.js';
import { resolveComponentFreshness, resolveComponentFreshnessFromCompare } from '../lib/deployment-freshness-resolution.ts';
import { classifyChanges } from '../scripts/classify-changes.mjs';

const samples = [
  ['components/DeploymentFooter.tsx'],
  ['adt-runtime/src/server.ts'],
  ['codex-runner/src/server.ts'],
  ['codex-runner/release.json'],
  ['specs/000-current-application-spec.md'],
  ['package.json'],
  ['adt-runtime/README.md'],
  ['codex-runner/README.md'],
  ['migrations/0010_example.sql'],
  ['future-system/config.xyz'],
  ['components/AppHeader.tsx', 'adt-runtime/src/server.ts', 'codex-runner/src/server.ts'],
];

test('shared deployment component impact stays aligned with CI classification', () => {
  for (const paths of samples) {
    const impact = deploymentComponentImpact(paths);
    const classified = classifyChanges(paths.map(filename => ({ filename, status: 'modified' })));
    assert.equal(impact.worker, classified.deploy_worker, paths.join(', '));
    assert.equal(impact.runtime, classified.publish_runtime, paths.join(', '));
    assert.equal(impact.runner, classified.publish_runner, paths.join(', '));
    assert.equal(hasUnclassifiedDeploymentChanges(paths), classified.has_unclassified_changes, paths.join(', '));
  }
});

test('renamed paths can be evaluated with both old and new names', () => {
  const impact = deploymentComponentImpact(['docs/old.md', 'adt-runtime/src/new-location.ts']);
  assert.deepEqual(impact, { worker: false, runtime: true, runner: false });
});

test('compare resolution is component-aware rather than exact-SHA-only', () => {
  const head = 'a'.repeat(40);
  const docsOnly = { status: 'ahead', head_commit: { sha: head }, files: [{ filename: 'docs/operations.md' }] };
  assert.deepEqual(resolveComponentFreshnessFromCompare('worker', docsOnly, head), { state: 'current', sourceHeadRevision: head });
  assert.deepEqual(resolveComponentFreshnessFromCompare('runtime', docsOnly, head), { state: 'current', sourceHeadRevision: head });

  const workerChange = { status: 'ahead', head_commit: { sha: head }, files: [{ filename: 'components/DeploymentFooter.tsx' }] };
  assert.equal(resolveComponentFreshnessFromCompare('worker', workerChange, head).state, 'superseded');
  assert.equal(resolveComponentFreshnessFromCompare('runtime', workerChange, head).state, 'current');
  assert.equal(resolveComponentFreshnessFromCompare('runner', workerChange, head).state, 'current');
});

test('matching deployed head is current without an unnecessary comparison', async () => {
  const head = 'a'.repeat(40);
  let comparisons = 0;
  assert.deepEqual(await resolveComponentFreshness('worker', head, head, async () => { comparisons++; }), { state: 'current', sourceHeadRevision: head });
  assert.equal(comparisons, 0);
});

test('observed production revisions retain current Worker and Runtime when later changes do not impact Runtime', async () => {
  const head = '22fc4bfb50e7c7a68e1a65cb97d8d7ba17744331';
  const runtime = 'b7b1ce84a08e065bb998c02838d17f0264dfcbe2';
  const comparison = { status: 'ahead', head_commit: { sha: head }, files: [{ filename: 'components/InfrastructureFreshnessIndicator.tsx' }] };
  assert.equal((await resolveComponentFreshness('worker', head, head, async () => comparison)).state, 'current');
  assert.equal((await resolveComponentFreshness('runtime', runtime, head, async () => comparison)).state, 'current');
  assert.equal((await resolveComponentFreshness('runner', runtime, head, async () => comparison)).state, 'current');
});

test('a later Runtime image change makes an older Runtime superseded', async () => {
  const head = 'a'.repeat(40), deployed = 'b'.repeat(40);
  const comparison = { status: 'ahead', head_commit: { sha: head }, files: [{ filename: 'adt-runtime/src/server.ts' }] };
  assert.equal((await resolveComponentFreshness('runtime', deployed, head, async () => comparison)).state, 'superseded');
});

test('compare resolution fails closed when the deployment classifier cannot classify a path', () => {
  const head = 'd'.repeat(40);
  const unknownChange = { status: 'ahead', head_commit: { sha: head }, files: [{ filename: 'future-system/config.xyz' }] };
  assert.equal(classifyChanges(unknownChange.files).has_unclassified_changes, true);
  assert.deepEqual(resolveComponentFreshnessFromCompare('worker', unknownChange, head), { state: 'unknown' });
  assert.deepEqual(resolveComponentFreshnessFromCompare('runtime', unknownChange, head), { state: 'unknown' });
  assert.deepEqual(resolveComponentFreshnessFromCompare('runner', unknownChange, head), { state: 'unknown' });
});

test('compare resolution accounts for renamed component inputs', () => {
  const head = 'b'.repeat(40);
  const renamed = {
    status: 'ahead',
    head_commit: { sha: head },
    files: [{ filename: 'docs/retired-runtime-note.md', previous_filename: 'adt-runtime/src/legacy.ts' }],
  };
  assert.equal(resolveComponentFreshnessFromCompare('runtime', renamed, head).state, 'superseded');
});

test('compare resolution requires the exact expected source head', () => {
  const head = 'e'.repeat(40);
  const other = 'f'.repeat(40);
  const value = { status: 'ahead', head_commit: { sha: other }, files: [{ filename: 'docs/operations.md' }] };
  assert.deepEqual(resolveComponentFreshnessFromCompare('worker', value, head), { state: 'unknown' });
  assert.deepEqual(resolveComponentFreshnessFromCompare('worker', { ...value, head_commit: {} }, head), { state: 'unknown' });
});

test('compare resolution fails unknown on divergence or a possibly truncated file list', () => {
  const head = 'c'.repeat(40);
  assert.deepEqual(resolveComponentFreshnessFromCompare('worker', { status: 'diverged', head_commit: { sha: head }, files: [] }, head), { state: 'unknown' });
  const files = Array.from({ length: 300 }, (_, index) => ({ filename: `components/generated-${index}.tsx` }));
  assert.deepEqual(resolveComponentFreshnessFromCompare('worker', { status: 'ahead', head_commit: { sha: head }, files }, head), { state: 'unknown' });
});
