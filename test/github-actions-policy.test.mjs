import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseApprovedActionsManifest, validateWorkflowActionPolicy } from '../scripts/github-actions-policy.mjs';

const checkoutSha = '9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0';
const setupNodeSha = '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e';
const approvals = parseApprovedActionsManifest(readFileSync('.github/approved-actions.json', 'utf8'));
const workflow = (uses) => ({ '.github/workflows/test.yml': `steps:\n  - uses: ${uses}\n` });

test('the current checkout and setup-node releases are approved', () => {
  assert.deepEqual(approvals.get('actions/checkout'), { sha: checkoutSha, tag: 'v7.0.0' });
  assert.deepEqual(approvals.get('actions/setup-node'), { sha: setupNodeSha, tag: 'v6.4.0' });
});

test('an approved SHA and release comment pair succeeds', () => {
  const workflows = workflow(`actions/checkout@${checkoutSha} # actions/checkout@v7.0.0`);
  workflows['.github/workflows/setup.yml'] = `steps:\n  - uses: actions/setup-node@${setupNodeSha} # actions/setup-node@v6.4.0\n`;
  assert.deepEqual(validateWorkflowActionPolicy(workflows, approvals), []);
});

test('an unknown Action fails closed', () => {
  const errors = validateWorkflowActionPolicy(workflow(`example/unknown@${checkoutSha} # example/unknown@v1.0.0`), approvals);
  assert.match(errors.join('\n'), /unapproved GitHub Action example\/unknown/);
});

test('an unapproved SHA requires explicit promotion', () => {
  const errors = validateWorkflowActionPolicy(workflow(`actions/checkout@${'a'.repeat(40)} # actions/checkout@v7.0.1`), new Map([['actions/checkout', approvals.get('actions/checkout')]]));
  assert.match(errors.join('\n'), /Unapproved GitHub Action release:[\s\S]*requested tag: v7\.0\.1/);
  assert.match(errors.join('\n'), /update\n\.github\/approved-actions\.json to promote it/);
});

test('the approved SHA with an incorrect release comment fails', () => {
  const errors = validateWorkflowActionPolicy(workflow(`actions/checkout@${checkoutSha} # actions/checkout@v7.0.1`), new Map([['actions/checkout', approvals.get('actions/checkout')]]));
  assert.match(errors.join('\n'), /requested tag: v7\.0\.1[\s\S]*approved tag:  v7\.0\.0/);
});

test('a tag-like Action ref fails immutable pinning', () => {
  const errors = validateWorkflowActionPolicy(workflow('actions/checkout@v7 # actions/checkout@v7.0.0'), new Map([['actions/checkout', approvals.get('actions/checkout')]]));
  assert.match(errors.join('\n'), /exact 40-character lowercase hexadecimal commit SHA/);
});

test('malformed manifests fail closed', () => {
  assert.throws(() => parseApprovedActionsManifest('{'), /Malformed approved Actions manifest/);
  assert.throws(() => parseApprovedActionsManifest('{"schemaVersion":2,"actions":{}}'), /Unsupported/);
  assert.throws(
    () => parseApprovedActionsManifest('{"schemaVersion":1,"actions":{"actions/checkout":{"sha":"abc","tag":"v1"}}}'),
    /40 lowercase hexadecimal/,
  );
});

test('duplicate manifest entries fail closed', () => {
  const entry = `{"sha":"${checkoutSha}","tag":"v7.0.0"}`;
  assert.throws(
    () => parseApprovedActionsManifest(`{"schemaVersion":1,"actions":{"actions/checkout":${entry},"actions/checkout":${entry}}}`),
    /duplicate Action entries/,
  );
});
