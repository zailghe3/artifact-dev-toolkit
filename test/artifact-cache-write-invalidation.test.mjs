import assert from 'node:assert/strict';
import test from 'node:test';
import { completeWriteWithInvalidation } from '../lib/artifact-cache-invalidation.ts';

const identity = { repositoryId: 99, owner: 'owner', repo: 'repo' };
for (const operation of ['create', 'update', 'variation']) test(`successful ${operation} survives cache invalidation failure`, async () => {
  const success = { operation, commitSha: 'abc123' }; const logs = []; const secret = 'github_pat_secret'; const body = 'private artifact body';
  const result = await completeWriteWithInvalidation(async () => success, async () => { throw new Error(`${secret} ${body}`); }, identity, { error: message => logs.push(message) });
  assert.equal(result, success); assert.equal(logs.length, 1); assert.match(logs[0], /cache_invalidation_failure/); assert.doesNotMatch(logs[0], new RegExp(`${secret}|${body}`));
});
