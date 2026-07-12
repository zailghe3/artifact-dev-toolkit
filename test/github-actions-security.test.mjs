import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const workflowFiles = readdirSync('.github/workflows')
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .map((file) => `.github/workflows/${file}`)
  .sort();

const thirdPartyActionPattern = /^\s*uses:\s+([^\s#@]+\/[^\s#@]+)@([^\s#]+)(?:\s+#\s+(.+))?\s*$/gm;
const fullShaPattern = /^[0-9a-f]{40}$/;

const expectedActionReleases = new Map([
  ['actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0', 'actions/checkout@v7.0.0'],
  ['actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e', 'actions/setup-node@v6.4.0'],
]);

test('third-party workflow actions are pinned to full SHAs with accurate release comments', () => {
  const findings = [];

  for (const workflowFile of workflowFiles) {
    const workflow = readFileSync(workflowFile, 'utf8');
    for (const match of workflow.matchAll(thirdPartyActionPattern)) {
      const [, action, ref, comment = ''] = match;
      const key = `${action}@${ref}`;
      findings.push({ workflowFile, action, ref, comment });
      assert.match(ref, fullShaPattern, `${workflowFile} must pin ${action} to a full commit SHA`);
      assert.equal(
        comment.trim(),
        expectedActionReleases.get(key),
        `${workflowFile} must document the release tag for ${key}`,
      );
    }
  }

  assert.ok(findings.length > 0, 'expected at least one third-party action use');
});

test('setup-node workflows consume the canonical Node.js version file', () => {
  for (const workflowFile of workflowFiles) {
    const workflow = readFileSync(workflowFile, 'utf8');
    if (!workflow.includes('actions/setup-node@')) continue;
    assert.match(workflow, /node-version-file:\s+\.nvmrc/, `${workflowFile} must use .nvmrc for Node.js`);
    assert.doesNotMatch(workflow, /node-version:\s*['"]?\d+/, `${workflowFile} must not hard-code Node.js`);
  }
});

test('trusted pull_request_target auto-merge never checks out pull-request code', () => {
  const workflow = readFileSync('.github/workflows/auto-merge.yml', 'utf8');
  assert.match(workflow, /pull_request_target:/);
  assert.doesNotMatch(workflow, /actions\/checkout@/);
  assert.match(workflow, /gh api --paginate/);
});
