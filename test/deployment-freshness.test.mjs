import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChanges } from '../scripts/classify-changes.mjs';
import {
  evaluateOperationFreshness,
  parseGitNameStatus,
} from '../scripts/evaluate-deployment-freshness.mjs';

const impact = (...files) => classifyChanges(files.map((filename) => ({ filename })));

function cloudflare(interveningImpact, overrides = {}) {
  return evaluateOperationFreshness({
    operation: 'cloudflare',
    targetDeployWorker: true,
    targetApplyMigrations: true,
    interveningImpact,
    ...overrides,
  });
}

test('Worker target is not superseded by a later migration-only change', () => {
  assert.equal(cloudflare(impact('migrations/0019_later.sql')).current, true);
});

test('Worker target is superseded by a later Worker input', () => {
  assert.equal(cloudflare(impact('app/page.tsx')).current, false);
});

test('migration-only target is superseded by a later migration', () => {
  const result = evaluateOperationFreshness({
    operation: 'cloudflare',
    targetDeployWorker: false,
    targetApplyMigrations: true,
    interveningImpact: impact('migrations/0019_later.sql'),
  });
  assert.equal(result.current, false);
});

test('migration-only target is superseded by a later Worker because Worker catch-up applies pending migrations', () => {
  const result = evaluateOperationFreshness({
    operation: 'cloudflare',
    targetDeployWorker: false,
    targetApplyMigrations: true,
    interveningImpact: impact('app/page.tsx'),
  });
  assert.equal(result.current, false);
});

test('irrelevant successor does not stale Worker, Runtime, or Runner operations', () => {
  const docs = impact('README.md');
  assert.equal(cloudflare(docs).current, true);
  assert.equal(evaluateOperationFreshness({ operation: 'runtime', interveningImpact: docs }).current, true);
  assert.equal(evaluateOperationFreshness({ operation: 'runner', interveningImpact: docs }).current, true);
});

test('unclassified successor fails closed for every production operation', () => {
  const unknown = impact('future-subsystem/config.bin');
  assert.equal(cloudflare(unknown).current, false);
  assert.equal(evaluateOperationFreshness({ operation: 'runtime', interveningImpact: unknown }).current, false);
  assert.equal(evaluateOperationFreshness({ operation: 'runner', interveningImpact: unknown }).current, false);
});

test('shared Runner release barrier preserves the exact Worker obligation across unrelated later Worker or migration changes', () => {
  const laterWorker = cloudflare(impact('app/page.tsx'), { targetRunnerReleaseBarrier: true });
  const laterMigration = cloudflare(impact('migrations/0019_later.sql'), { targetRunnerReleaseBarrier: true });
  assert.equal(laterWorker.current, true);
  assert.equal(laterMigration.current, true);
});

test('a newer shared Runner release supersedes an older release barrier', () => {
  const result = cloudflare(impact('codex-runner/release.json'), { targetRunnerReleaseBarrier: true });
  assert.equal(result.current, false);
});

test('component publishers remain independently scoped to newer image inputs', () => {
  assert.equal(
    evaluateOperationFreshness({ operation: 'runtime', interveningImpact: impact('adt-runtime/src/server.ts') }).current,
    false,
  );
  assert.equal(
    evaluateOperationFreshness({ operation: 'runtime', interveningImpact: impact('codex-runner/src/server.ts') }).current,
    true,
  );
  assert.equal(
    evaluateOperationFreshness({ operation: 'runner', interveningImpact: impact('codex-runner/src/server.ts') }).current,
    false,
  );
  assert.equal(
    evaluateOperationFreshness({ operation: 'runner', interveningImpact: impact('adt-runtime/src/server.ts') }).current,
    true,
  );
});

test('Git name-status parsing preserves both sides of renames for shared classification', () => {
  assert.deepEqual(
    parseGitNameStatus('R100\tapp/old.tsx\tapp/new.tsx\nA\tdocs/new.md\nD\tdocs/old.md\n'),
    [
      { status: 'renamed', previous_filename: 'app/old.tsx', filename: 'app/new.tsx' },
      { status: 'added', filename: 'docs/new.md' },
      { status: 'removed', filename: 'docs/old.md' },
    ],
  );
});

test('invalid Cloudflare freshness contracts fail instead of silently weakening the barrier', () => {
  const docs = impact('README.md');
  assert.throws(
    () => evaluateOperationFreshness({
      operation: 'cloudflare',
      targetDeployWorker: false,
      targetApplyMigrations: false,
      interveningImpact: docs,
    }),
    /at least one target operation/,
  );
  assert.throws(
    () => evaluateOperationFreshness({
      operation: 'cloudflare',
      targetDeployWorker: false,
      targetApplyMigrations: true,
      targetRunnerReleaseBarrier: true,
      interveningImpact: docs,
    }),
    /requires a Worker deployment/,
  );
});
