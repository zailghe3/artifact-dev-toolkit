import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deploymentComponentImpact,
  hasUnclassifiedDeploymentChanges,
} from '../lib/deployment-component-impact.js';
import { classifyChanges } from '../scripts/classify-changes.mjs';

const samples = [
  ['components/DeploymentFooter.tsx'],
  ['adt-runtime/src/server.ts'],
  ['codex-runner/src/server.ts'],
  ['third_party/adrian/backend/go.mod'],
  ['codex-runner/release.json'],
  ['specs/000-current-application-spec.md'],
  ['package.json'],
  ['adt-runtime/README.md'],
  ['codex-runner/README.md'],
  ['test-fixtures/legacy-operational-migrations/0010_example.sql'],
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
    assert.equal(impact.adrian, classified.publish_adrian, paths.join(', '));
    assert.equal(hasUnclassifiedDeploymentChanges(paths), classified.has_unclassified_changes, paths.join(', '));
  }
});

test('renamed paths can be evaluated with both old and new names', () => {
  const impact = deploymentComponentImpact(['docs/old.md', 'adt-runtime/src/new-location.ts']);
  assert.deepEqual(impact, { worker: false, runtime: true, runner: false, adrian: false });
});

test('Runtime release manifest is a shared Worker and Runtime input',()=>{const impact=deploymentComponentImpact(['adt-runtime/release.json']);assert.deepEqual(impact,{worker:true,runtime:true,runner:false,adrian:false});const classified=classifyChanges([{filename:'adt-runtime/release.json',status:'modified'}]);assert.equal(classified.deploy_worker,true);assert.equal(classified.publish_runtime,true);assert.equal(classified.publish_runner,false)});


test('OpenAI model policy changes verify and publish both consumers',()=>{
  const path='adt-runtime/src/openai-model-policy.ts';
  assert.deepEqual(deploymentComponentImpact([path]),{worker:true,runtime:true,runner:false,adrian:false});
  const classified=classifyChanges([{filename:path,status:'modified'}]);
  assert.equal(classified.deploy_worker,true);
  assert.equal(classified.publish_runtime,true);
  assert.equal(classified.verify_integration,true);
});

test('Runtime migrations and the shared settings contract select the required checks and publications', () => {
  const migration = classifyChanges([{filename:'adt-runtime/migrations/0001_operational_state.sql',status:'modified'}]);
  assert.equal(migration.publish_runtime, true);
  assert.equal(migration.smoke_runtime_image, true);
  assert.equal(migration.deploy_cloudflare, false);
  const contract = classifyChanges([{filename:'adt-runtime/src/operational-settings-contract.ts',status:'modified'}]);
  assert.equal(contract.deploy_worker, true);
  assert.equal(contract.publish_runtime, true);
  assert.equal(contract.verify_integration, true);
  const postgresTest = classifyChanges([{filename:'test/integration/postgres-runtime-integration.test.mjs',status:'modified'}]);
  assert.equal(postgresTest.verify_integration, true);
  assert.equal(postgresTest.publish_runtime, false);
});
