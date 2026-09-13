import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateAutoMergeEligibility } from '../scripts/auto-merge-eligibility.mjs';
import {
  isCiCdGuardrailTestPath,
  isLowSensitivityAutoMergePath,
  requiresManualReviewPath,
} from '../scripts/change-policy.mjs';

const ordinaryFile = { filename: 'docs/operations.md', status: 'modified' };

function evaluate(overrides = {}) {
  return evaluateAutoMergeEligibility({
    author: 'repository-owner',
    repositoryOwner: 'repository-owner',
    repository: 'repository-owner/artifact-dev-toolkit',
    headRepository: 'repository-owner/artifact-dev-toolkit',
    files: [ordinaryFile],
    ...overrides,
  });
}

test('trusted same-repository pull request changing only allowlisted low-sensitivity files is eligible', () => {
  assert.equal(evaluate().eligible, true);
  assert.equal(evaluate({ files: [{ filename: 'requests/features/ui-001.json', status: 'added' }] }).eligible, true);
  assert.equal(evaluate({ files: [{ filename: 'public/logo.png', status: 'modified' }] }).eligible, true);
  assert.equal(evaluate({ files: [{ filename: 'app/globals.css', status: 'modified' }] }).eligible, true);
});

test('pull request authored by another user is skipped', () => {
  const result = evaluate({ author: 'octocat' });

  assert.equal(result.eligible, false);
  assert.match(result.reason, /not the repository owner/);
});

test('pull request from a fork is skipped', () => {
  const result = evaluate({ headRepository: 'octocat/artifact-dev-toolkit' });

  assert.equal(result.eligible, false);
  assert.match(result.reason, /fork or different repository/);
});

test('server-side app and component code require manual review', () => {
  for (const filename of [
    'app/page.tsx',
    'app/artifacts/[id]/page.tsx',
    'app/api/artifacts/route.ts',
    'components/AppHeader.tsx',
    'components/client-widget.tsx',
  ]) {
    const result = evaluate({ files: [{ filename, status: 'modified' }] });
    assert.equal(result.eligible, false, filename);
    assert.match(result.reason, /outside the low-sensitivity auto-merge allowlist/);
  }
});

test('governance, automation, deployment, Runtime, Runner, migration, and library code require manual review', () => {
  for (const filename of [
    'AGENTS.md',
    'specs/AGENTS.md',
    'docs/subsystem/AGENTS.md',
    '.agents/skills/code-change-verification/SKILL.md',
    '.github/workflows/example.yml',
    '.github/actions/deploy/action.yml',
    'package.json',
    'package-lock.json',
    'wrangler.jsonc',
    'open-next.config.ts',
    'next.config.ts',
    'cloudflare-worker.ts',
    'scripts/deploy.mjs',
    'migrations/0001.sql',
    'lib/auth.ts',
    'adt-runtime/src/server.ts',
    'codex-runner/src/server.ts',
  ]) {
    assert.equal(requiresManualReviewPath(filename), true, filename);
    assert.equal(evaluate({ files: [{ filename, status: 'modified' }] }).eligible, false, filename);
  }
});

test('CI/CD and trust-boundary guardrail tests are explicitly recognized and require manual review', () => {
  for (const filename of [
    'test/auto-merge-eligibility.test.mjs',
    'test/auto-merge-orchestration.test.mjs',
    'test/change-classification.test.mjs',
    'test/deployment-freshness.test.mjs',
    'test/deployment-workflow.test.mjs',
    'test/adt-runtime-publication.test.mjs',
    'test/codex-runner-publish-workflow.test.mjs',
    'test/integration/workflow-runtime-integration.test.mjs',
  ]) {
    assert.equal(isCiCdGuardrailTestPath(filename), true, filename);
    assert.equal(isLowSensitivityAutoMergePath(filename), false, filename);
    assert.equal(evaluate({ files: [{ filename, status: 'modified' }] }).eligible, false, filename);
  }
});

test('ordinary executable tests are conservative manual-review changes under the positive allowlist', () => {
  assert.equal(evaluate({ files: [{ filename: 'test/artifacts.test.mjs', status: 'modified' }] }).eligible, false);
});

test('renaming from or to a manual-review path cannot bypass the allowlist', () => {
  const fromExecutable = evaluate({
    files: [{ filename: 'docs/renamed.md', previous_filename: 'app/page.tsx', status: 'renamed' }],
  });
  assert.equal(fromExecutable.eligible, false);

  const toExecutable = evaluate({
    files: [{ filename: 'app/page.tsx', previous_filename: 'docs/old.md', status: 'renamed' }],
  });
  assert.equal(toExecutable.eligible, false);
});

test('a sensitive file on a later paginated API page still blocks auto-merge', () => {
  const files = Array.from({ length: 101 }, (_, index) => ({ filename: `docs/file-${index}.md`, status: 'modified' }));
  files.push({ filename: '.github/actions/deploy/action.yml', status: 'added' });

  const result = evaluate({ files });

  assert.equal(result.eligible, false);
  assert.match(result.reason, /.github\/actions\/deploy\/action.yml/);
});

test('unknown paths and empty changes fail closed', () => {
  assert.equal(evaluate({ files: [{ filename: 'future-subsystem/config.bin', status: 'added' }] }).eligible, false);
  assert.equal(evaluate({ files: [] }).eligible, false);
});
