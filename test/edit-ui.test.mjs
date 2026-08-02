import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPreview, proposalErrorMessage, safeGitHubUrl } from '../lib/edit-ui.ts';
import { ArtifactWriteValidationError, proposalBranchName } from '../lib/artifact-repository.ts';

test('proposal branch names are deterministic, revision-specific, safe, bounded, and fail closed', () => {
  const a = proposalBranchName('client-artifact', 'abcdef0123456789');
  assert.equal(a, proposalBranchName('client-artifact', 'abcdef0123456789'));
  assert.equal(a, 'artifact-change/client-artifact-abcdef01');
  assert.notEqual(a, proposalBranchName('client-artifact', '1234567890abcdef'));
  assert.match(a, /^[a-z0-9/-]+$/); assert.ok(a.length <= 105);
  for (const [id, sha] of [['../bad', 'abcdef0123'], ['good', 'not-sha'], ['a'.repeat(81), 'abcdef0123']]) assert.throws(() => proposalBranchName(id, sha), ArtifactWriteValidationError);
});

test('edit helpers recognize only safe GitHub result links and preview shapes', () => {
  assert.equal(safeGitHubUrl('https://github.com/o/r/commit/abc123', 'commit'), 'https://github.com/o/r/commit/abc123');
  assert.equal(safeGitHubUrl('https://github.com/o/r/pull/40', 'pull'), 'https://github.com/o/r/pull/40');
  for (const value of ['http://github.com/o/r/pull/1', 'https://evil.test/o/r/pull/1', 'https://github.com/o/r/issues/1', 'bad']) assert.equal(safeGitHubUrl(value, 'pull'), undefined);
  assert.equal(hasPreview({ metadata: { title: 'Draft', status: 'draft', tags: [], aliases: [] }, bodyHtml: '<p>safe</p>' }), true);
  assert.equal(hasPreview({ bodyHtml: '<p>missing metadata</p>' }), false);
  assert.match(proposalErrorMessage('write_conflict'), /Reload/);
});
