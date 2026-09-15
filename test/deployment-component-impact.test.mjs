import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentComponentImpact } from '../lib/deployment-component-impact.js';
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
