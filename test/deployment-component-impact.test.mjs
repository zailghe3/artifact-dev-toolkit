import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentComponentImpact } from '../lib/deployment-component-impact.js';
import { resolveComponentFreshnessFromCompare } from '../lib/deployment-freshness-resolution.ts';
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
  ['components/AppHeader.tsx', 'adt-runtime/src/server.ts', 'codex-runner/src/server.ts'],
];

test('shared deployment component impact stays aligned with CI classification', () => {
  for (const paths of samples) {
    const impact = deploymentComponentImpact(paths);
    const classified = classifyChanges(paths.map(filename => ({ filename, status: 'modified' })));
    assert.equal(impact.worker, classified.deploy_worker, paths.join(', '));
    assert.equal(impact.runtime, classified.publish_runtime, paths.join(', '));
    assert.equal(impact.runner, classified.publish_runner, paths.join(', '));
  }
});

test('renamed paths can be evaluated with both old and new names', () => {
  const impact = deploymentComponentImpact(['docs/old.md', 'adt-runtime/src/new-location.ts']);
  assert.deepEqual(impact, { worker: false, runtime: true, runner: false });
});

test('compare resolution is component-aware rather than exact-SHA-only', () => {
  const head = 'a'.repeat(40);
  const docsOnly = { status: 'ahead', head_commit: { sha: head }, files: [{ filename: 'docs/operations.md' }] };
  assert.deepEqual(resolveComponentFreshnessFromCompare('worker', docsOnly), { state: 'current', latestRelevantRevision: head });
  assert.deepEqual(resolveComponentFreshnessFromCompare('runtime', docsOnly), { state: 'current', latestRelevantRevision: head });

  const workerChange = { status: 'ahead', head_commit: { sha: head }, files: [{ filename: 'components/DeploymentFooter.tsx' }] };
  assert.equal(resolveComponentFreshnessFromCompare('worker', workerChange).state, 'superseded');
  assert.equal(resolveComponentFreshnessFromCompare('runtime', workerChange).state, 'current');
  assert.equal(resolveComponentFreshnessFromCompare('runner', workerChange).state, 'current');
});

test('compare resolution accounts for renamed component inputs', () => {
  const head = 'b'.repeat(40);
  const renamed = {
    status: 'ahead',
    head_commit: { sha: head },
    files: [{ filename: 'docs/retired-runtime-note.md', previous_filename: 'adt-runtime/src/legacy.ts' }],
  };
  assert.equal(resolveComponentFreshnessFromCompare('runtime', renamed).state, 'superseded');
});

test('compare resolution fails unknown on divergence or a possibly truncated file list', () => {
  const head = 'c'.repeat(40);
  assert.deepEqual(resolveComponentFreshnessFromCompare('worker', { status: 'diverged', head_commit: { sha: head }, files: [] }), { state: 'unknown' });
  const files = Array.from({ length: 300 }, (_, index) => ({ filename: `components/generated-${index}.tsx` }));
  assert.deepEqual(resolveComponentFreshnessFromCompare('worker', { status: 'ahead', head_commit: { sha: head }, files }), { state: 'unknown' });
});
