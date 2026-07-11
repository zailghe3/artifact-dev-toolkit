import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateFeatureRequestData, validateFeatureRequestFile } from '../scripts/feature-request-validation.mjs';

const validRequest = {
  featureId: 'DEV-999',
  objective: 'Validate contributed feature request JSON before issue creation.',
  userContext: 'Maintainers need safe pull-request validation.',
  currentBehaviour: 'Pending JSON may be proposed before merge.',
  requiredBehaviour: 'The JSON renders to a complete implementation-ready issue after merge.',
  functionalRequirements: ['Validate schema fields.', 'Dry-run render the issue body.'],
  acceptanceCriteria: ['Validation succeeds without creating issues.', 'The rendered body contains all required guidance.'],
};

function withTempFile(name, data, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'feature-request-'));
  const file = join(dir, name);
  writeFileSync(file, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
  try {
    return callback(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('valid pending JSON passes validation and renders the execution contract and definition of done', () => {
  const rendered = validateFeatureRequestData(validRequest);
  assert.match(rendered, /## Codex execution contract/);
  assert.match(rendered, /## Definition of done/);
  assert.match(rendered, /The current application specification has been reviewed/);
});

test('invalid JSON fails clearly with the file-specific CLI validator', () => {
  withTempFile('invalid.json', '{ invalid json', (file) => {
    assert.throws(() => execFileSync(process.execPath, ['scripts/validate-feature-request.mjs', file], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }), /Command failed/);
  });
});

test('missing required fields fail clearly', () => {
  assert.throws(
    () => validateFeatureRequestData({ ...validRequest, objective: '' }),
    /Missing required feature issue field\(s\): objective \(objective\)/,
  );
});

test('long content renders without truncation', () => {
  const longText = 'Long acceptance detail. '.repeat(1000);
  const rendered = validateFeatureRequestData({ ...validRequest, acceptanceCriteria: [longText] });
  assert.ok(rendered.includes(longText.trim()));
});

test('multiple request files are supported by the dry-run validator without creating issues', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feature-requests-'));
  try {
    const first = join(dir, 'first.json');
    const second = join(dir, 'second.json');
    writeFileSync(first, `${JSON.stringify(validRequest)}\n`);
    writeFileSync(second, `${JSON.stringify({ ...validRequest, featureId: 'DEV-998' })}\n`);
    const output = execFileSync(process.execPath, ['scripts/validate-feature-request.mjs', first, second], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.match(output, new RegExp(`Validated ${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(output, new RegExp(`Validated ${second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processed-file commits do not appear in changed pending request detection', () => {
  const output = execFileSync('git', [
    'diff',
    '--name-only',
    '--diff-filter=AM',
    'HEAD',
    'HEAD',
    '--',
    'requests/features/pending/*.json',
  ], { encoding: 'utf8' });
  assert.equal(output, '');
});

test('file validator accepts valid JSON from disk', () => {
  withTempFile('valid.json', validRequest, (file) => {
    assert.match(validateFeatureRequestFile(file), /DEV-999/);
  });
});

test('Codex feature-request instructions define deterministic branch and request filename', () => {
  const instructions = execFileSync('cat', ['docs/codex-create-feature-request.md'], { encoding: 'utf8' });
  assert.match(instructions, /feature-request\/<request-id>/);
  assert.match(instructions, /requests\/features\/pending\/<request-id>\.json/);
  assert.match(instructions, /exact `requestId` supplied/);
});

test('Codex feature-request instructions forbid implementation and direct issue creation', () => {
  const instructions = execFileSync('cat', ['docs/codex-create-feature-request.md'], { encoding: 'utf8' });
  assert.match(instructions, /Do not implement the feature itself\./);
  assert.match(instructions, /Do not create the GitHub issue directly\./);
  assert.match(instructions, /Let the post-merge workflow create the GitHub issue/);
});

test('ChatGPT prompt template is copy-pasteable and stops after opening a PR', () => {
  const template = execFileSync('cat', ['docs/templates/codex-create-feature-request-prompt.md'], { encoding: 'utf8' });
  assert.match(template, /https:\/\/github\.com\/zailghe3\/artifact-dev-toolkit/);
  assert.match(template, /Follow `docs\/codex-create-feature-request\.md` exactly\./);
  assert.match(template, /open a non-draft pull request, and stop/);
  assert.match(template, /Do not implement the feature\./);
  assert.match(template, /"requestId": "<request-id>"/);
});

test('development workflow documents ChatGPT-to-Codex responsibilities', () => {
  const workflow = execFileSync('cat', ['docs/development-workflow.md'], { encoding: 'utf8' });
  assert.match(workflow, /ChatGPT is responsible for product definition and the complete structured feature content/);
  assert.match(workflow, /Codex is responsible for repository changes, validation, commits, and pull requests/);
  assert.match(workflow, /post-merge workflow creates issue/);
});

test('issue creation workflow opens processing PRs instead of pushing directly to main', () => {
  const workflow = execFileSync('cat', ['.github/workflows/create-feature-issues.yml'], { encoding: 'utf8' });
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /Open processed request pull requests/);
  assert.match(workflow, /node scripts\/open-feature-request-processing-prs\.mjs/);
  assert.doesNotMatch(workflow, /\bgit push\b/);
});

test('processing helper uses deterministic branch naming and reuses existing PRs', async () => {
  const helper = await import('../scripts/open-feature-request-processing-prs.mjs');
  assert.equal(helper.processingBranchName('UI-001'), 'automation/process-feature-UI-001');
  assert.equal(helper.processingPrTitle({ requestId: 'ui-001', featureId: 'UI-001' }), 'Record processed feature request UI-001');
  const source = execFileSync('cat', ['scripts/open-feature-request-processing-prs.mjs'], { encoding: 'utf8' });
  assert.match(source, /pr', 'list', '--state', 'open', '--head', branch/);
  assert.match(source, /--force-with-lease/);
  assert.match(source, /No lifecycle changes remain/);
});

test('issue creation records stable markers and reuses an already-created issue', () => {
  const source = execFileSync('cat', ['scripts/create-feature-issues-from-requests.mjs'], { encoding: 'utf8' });
  assert.match(source, /feature-request:request-id=/);
  assert.match(source, /issue', 'list', '--state', 'all', '--search'/);
  assert.match(source, /status: 'created'/);
  assert.match(source, /issueNumber/);
  assert.match(source, /requestId/);
  assert.match(source, /featureId/);
});

test('development workflow documents processing PR lifecycle and no direct main push', () => {
  const workflow = execFileSync('cat', ['docs/development-workflow.md'], { encoding: 'utf8' });
  assert.match(workflow, /workflow creates processing branch/);
  assert.match(workflow, /workflow opens processing PR/);
  assert.match(workflow, /Direct pushes to `main` are intentionally not used/);
  assert.match(workflow, /automation\/process-feature-<request-id>/);
});
