import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { decidePullRequestAction } from '../scripts/auto-merge-orchestration.mjs';

const sha = 'a'.repeat(40);
const trusted = {
  number: 221,
  state: 'open',
  merged: false,
  merged_at: null,
  draft: false,
  base: { ref: 'main' },
  head: { sha, repo: { full_name: 'owner/repo' } },
  user: { login: 'owner' },
};
const decide = (pr = trusted) => decidePullRequestAction({
  pulls: [pr], validatedSha: sha, repository: 'owner/repo', repositoryOwner: 'owner',
});

test('current trusted owner head advances to eligibility evaluation', () => {
  assert.equal(decide().action, 'evaluate');
});

test('manual merge, sensitive or otherwise, is a successful no-op', () => {
  assert.deepEqual(decide({ ...trusted, state: 'closed', merged: true, merged_at: '2026-01-01' }).action, 'noop');
});

test('closed-unmerged and draft pull requests do not merge', () => {
  assert.equal(decide({ ...trusted, state: 'closed' }).action, 'noop');
  assert.equal(decide({ ...trusted, draft: true }).action, 'noop');
});

test('stale, fork, and non-owner pull requests do not merge', () => {
  assert.equal(decide({ ...trusted, head: { ...trusted.head, sha: 'b'.repeat(40) } }).action, 'noop');
  assert.equal(decide({ ...trusted, head: { ...trusted.head, repo: { full_name: 'fork/repo' } } }).action, 'noop');
  assert.equal(decide({ ...trusted, user: { login: 'someone-else' } }).action, 'noop');
});

test('zero and multiple associated main pull requests fail closed', () => {
  const input = { validatedSha: sha, repository: 'owner/repo', repositoryOwner: 'owner' };
  assert.throws(() => decidePullRequestAction({ ...input, pulls: [] }), /exactly one/);
  assert.throws(() => decidePullRequestAction({ ...input, pulls: [trusted, { ...trusted, number: 222 }] }), /found 2/);
});

test('CLI receives the complete trusted environment used at the merge boundary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'auto-merge-'));
  const input = join(directory, 'pulls.json');
  writeFileSync(input, JSON.stringify([trusted]));
  const run = spawnSync(process.execPath, ['scripts/auto-merge-orchestration.mjs', input], {
    encoding: 'utf8',
    env: {
      ...process.env,
      REPOSITORY: 'owner/repo',
      REPOSITORY_OWNER: 'owner',
      VALIDATED_SHA: sha,
    },
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^action=evaluate$/m);
});
