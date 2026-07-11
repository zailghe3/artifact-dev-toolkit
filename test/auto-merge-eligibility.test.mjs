import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateAutoMergeEligibility, isSensitivePath } from '../scripts/auto-merge-eligibility.mjs';

const ordinaryFile = { filename: 'app/page.tsx', status: 'modified' };

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

test('trusted same-repository pull request changing ordinary files is eligible', () => {
  assert.equal(evaluate().eligible, true);
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

test('workflow file changes are sensitive', () => {
  const result = evaluate({ files: [{ filename: '.github/workflows/example.yml', status: 'modified' }] });

  assert.equal(result.eligible, false);
  assert.match(result.reason, /.github\/workflows\/example.yml/);
});

test('package.json changes are sensitive', () => {
  const result = evaluate({ files: [{ filename: 'package.json', status: 'modified' }] });

  assert.equal(result.eligible, false);
  assert.match(result.reason, /package.json/);
});

test('deleted or renamed sensitive files are sensitive', () => {
  assert.equal(evaluate({ files: [{ filename: 'scripts/old.mjs', status: 'removed' }] }).eligible, false);
  assert.equal(
    evaluate({ files: [{ filename: 'docs/renamed.mjs', previous_filename: 'scripts/old.mjs', status: 'renamed' }] }).eligible,
    false,
  );
});

test('sensitive file on a later paginated API page is skipped', () => {
  const files = Array.from({ length: 101 }, (_, index) => ({ filename: `app/file-${index}.tsx`, status: 'modified' }));
  files.push({ filename: '.github/actions/deploy/action.yml', status: 'added' });

  const result = evaluate({ files });

  assert.equal(result.eligible, false);
  assert.match(result.reason, /.github\/actions\/deploy\/action.yml/);
});

test('all configured sensitive path patterns are detected', () => {
  for (const path of [
    '.github/workflows/ci.yml',
    '.github/actions/setup/action.yml',
    'package.json',
    'package-lock.json',
    'wrangler.jsonc',
    'open-next.config.ts',
    'open-next.config.mjs',
    'scripts/deploy.mjs',
  ]) {
    assert.equal(isSensitivePath(path), true, path);
  }

  assert.equal(isSensitivePath('docs/scripts/example.md'), false);
});
