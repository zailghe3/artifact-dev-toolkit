import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseApprovedActionsManifest, validateWorkflowActionPolicy } from '../scripts/github-actions-policy.mjs';

const checkoutSha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const setupNodeSha = '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e';
const approvals = parseApprovedActionsManifest(readFileSync('.github/approved-actions.json', 'utf8'));
const workflow = (uses) => ({ '.github/workflows/test.yml': `steps:\n  - uses: ${uses}\n` });

test('the current checkout and setup-node releases are approved', () => {
  assert.deepEqual(approvals.get('actions/checkout'), { sha: checkoutSha, tag: 'v7.0.1' });
  assert.deepEqual(approvals.get('actions/setup-node'), { sha: setupNodeSha, tag: 'v6.4.0' });
});

test('an approved SHA and release comment pair succeeds', () => {
  const workflows = workflow(`actions/checkout@${checkoutSha} # actions/checkout@v7.0.1`);
  workflows['.github/workflows/setup.yml'] = `steps:\n  - uses: actions/setup-node@${setupNodeSha} # actions/setup-node@v6.4.0\n`;
  assert.deepEqual(validateWorkflowActionPolicy(workflows, approvals), []);
});

test('an unknown Action fails closed', () => {
  const errors = validateWorkflowActionPolicy(workflow(`example/unknown@${checkoutSha} # example/unknown@v1.0.0`), approvals);
  assert.match(errors.join('\n'), /unapproved GitHub Action example\/unknown/);
});

test('an unapproved SHA requires explicit promotion', () => {
  const errors = validateWorkflowActionPolicy(workflow(`actions/checkout@${'a'.repeat(40)} # actions/checkout@v7.0.2`), new Map([['actions/checkout', approvals.get('actions/checkout')]]));
  assert.match(errors.join('\n'), /Unapproved GitHub Action release:[\s\S]*requested tag: v7\.0\.2/);
  assert.match(errors.join('\n'), /update\n\.github\/approved-actions\.json to promote it/);
});

test('the approved SHA with an incorrect release comment fails', () => {
  const errors = validateWorkflowActionPolicy(workflow(`actions/checkout@${checkoutSha} # actions/checkout@v7.0.0`), new Map([['actions/checkout', approvals.get('actions/checkout')]]));
  assert.match(errors.join('\n'), /requested tag: v7\.0\.0[\s\S]*approved tag:  v7\.0\.1/);
});

test('a tag-like Action ref fails immutable pinning', () => {
  const errors = validateWorkflowActionPolicy(workflow('actions/checkout@v7 # actions/checkout@v7.0.1'), new Map([['actions/checkout', approvals.get('actions/checkout')]]));
  assert.match(errors.join('\n'), /exact 40-character lowercase hexadecimal commit SHA/);
});

test('malformed manifests fail closed', () => {
  assert.throws(() => parseApprovedActionsManifest('{'), /Malformed approved Actions manifest/);
  assert.throws(() => parseApprovedActionsManifest('{"schemaVersion":2,"actions":{}}'), /Unsupported/);
  assert.throws(() => parseApprovedActionsManifest('{"schemaVersion":1,"actions":{}}'), /actions must be an array/);
  assert.throws(
    () => parseApprovedActionsManifest('{"schemaVersion":1,"actions":[{"name":"actions/checkout","sha":"abc","tag":"v1"}]}'),
    /40 lowercase hexadecimal/,
  );
});

test('duplicate Action names fail regardless of entry property ordering', () => {
  assert.throws(
    () => parseApprovedActionsManifest(`{"schemaVersion":1,"actions":[{"name":"actions/checkout","sha":"${checkoutSha}","tag":"v7.0.1"},{"tag":"v7.0.1","name":"actions/checkout","sha":"${checkoutSha}"}]}`),
    /duplicate Action entry for actions\/checkout/,
  );
});

test('duplicate Action names fail when their SHAs differ', () => {
  assert.throws(
    () => parseApprovedActionsManifest(`{"schemaVersion":1,"actions":[{"name":"actions/checkout","sha":"${checkoutSha}","tag":"v7.0.1"},{"name":"actions/checkout","sha":"${'a'.repeat(40)}","tag":"v7.0.1"}]}`),
    /duplicate Action entry for actions\/checkout/,
  );
});

test('duplicate Action names fail when their tags differ', () => {
  assert.throws(
    () => parseApprovedActionsManifest(`{"schemaVersion":1,"actions":[{"name":"actions/checkout","sha":"${checkoutSha}","tag":"v7.0.1"},{"name":"actions/checkout","sha":"${checkoutSha}","tag":"v7.0.2"}]}`),
    /duplicate Action entry for actions\/checkout/,
  );
});

test('malformed Action entry keys fail closed', () => {
  assert.throws(
    () => parseApprovedActionsManifest(`{"schemaVersion":1,"actions":[{"name":"actions/checkout","sha":"${checkoutSha}","tag":"v7.0.1","trusted":true}]}`),
    /each Action must contain only name, sha, and tag/,
  );
});

test('an empty actions array fails when a Workflow references an Action', () => {
  const emptyApprovals = parseApprovedActionsManifest('{"schemaVersion":1,"actions":[]}');
  const errors = validateWorkflowActionPolicy(workflow(`actions/checkout@${checkoutSha} # actions/checkout@v7.0.1`), emptyApprovals);
  assert.match(errors.join('\n'), /unapproved GitHub Action actions\/checkout/);
});
