import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateFeatureRequestData, validateFeatureRequestFile } from '../scripts/feature-request-validation.mjs';

const validRequest = {
  requestId: 'dev-999-validation',
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
    writeFileSync(second, `${JSON.stringify({ ...validRequest, requestId: 'dev-998-validation', featureId: 'DEV-998' })}\n`);
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


test('changed feature request detection uses canonical directory only', () => {
  const source = execFileSync('cat', ['scripts/changed-feature-requests.mjs'], { encoding: 'utf8' });
  assert.match(source, /requests\/features\/\*\.json/);
  assert.match(source, /diff-filter=AM/);
  assert.doesNotMatch(source, /pending/);
  assert.doesNotMatch(source, /processed/);
});

test('file validator accepts valid JSON from disk', () => {
  withTempFile('valid.json', validRequest, (file) => {
    assert.match(validateFeatureRequestFile(file), /DEV-999/);
  });
});

test('feature requests require stable requestId orchestration field', () => {
  assert.throws(() => validateFeatureRequestData({ ...validRequest, requestId: '' }), /Missing required orchestration field: requestId/);
});

test('Codex feature-request instructions use permanent canonical files and grouped PRs', () => {
  const instructions = execFileSync('cat', ['docs/codex-create-feature-request.md'], { encoding: 'utf8' });
  assert.match(instructions, /feature-request\/<request-id>/);
  assert.match(instructions, /requests\/features\/<request-id>\.json/);
  assert.match(instructions, /When several feature requests are agreed together, place all corresponding JSON files in one pull request/);
  assert.doesNotMatch(instructions, /requests\/features\/pending\/<request-id>\.json/);
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

test('development workflow documents final feature planning automation', () => {
  const workflow = execFileSync('cat', ['docs/development-workflow.md'], { encoding: 'utf8' });
  assert.match(workflow, /Discuss and agree one or more features/);
  assert.match(workflow, /one issue per JSON is created automatically/);
  assert.match(workflow, /Feature JSON files remain permanently/);
  assert.match(workflow, /immutable `requestId`/);
  assert.match(workflow, /mode: all/);
  assert.match(workflow, /no pending-to-processed branch or pull-request lifecycle/i);
  assert.match(workflow, /No personal access token/);
});

test('issue creation uses immutable marker, searches open and closed issues, and never moves files', async () => {
  const helper = await import('../scripts/create-feature-issues-from-requests.mjs');
  assert.equal(helper.issueMarker('auth-002-private-repository-authorisation'), '<!-- feature-request-id: auth-002-private-repository-authorisation -->');
  const source = execFileSync('cat', ['scripts/create-feature-issues-from-requests.mjs'], { encoding: 'utf8' });
  assert.match(source, /'--state', 'all'/);
  assert.match(source, /Skipped .* marker already exists/);
  assert.doesNotMatch(source, /renameSync|moveWithMetadata|processedDir|failedDir/);
  assert.doesNotMatch(source, /gh', \['pr'|pr', 'create'|git', \['push'/);
});

test('issue creation supports changed and all-files recovery modes', async () => {
  const helper = await import('../scripts/create-feature-issues-from-requests.mjs');
  assert.deepEqual(helper.requestPaths({ env: { FEATURE_REQUEST_MODE: 'changed', FEATURE_REQUEST_FILES: 'requests/features/a.json\nrequests/features/nested/b.json' }, gitExec: () => '' }), ['requests/features/a.json']);
  assert.deepEqual(helper.requestPaths({ env: { FEATURE_REQUEST_MODE: 'all' }, gitExec: () => 'requests/features/a.json\nrequests/features/pending/b.json\nrequests/features/c.json\n' }), ['requests/features/a.json', 'requests/features/c.json']);
});

test('partial failure is safe to retry because issues are checked per request before create', () => {
  const source = execFileSync('cat', ['scripts/create-feature-issues-from-requests.mjs'], { encoding: 'utf8' });
  assert.match(source, /for \(const path of paths\)/);
  assert.match(source, /failures \+= 1/);
  assert.match(source, /findExistingIssue\(requestId\)/);
  assert.match(source, /continue|Failed to process/);
});

test('feature issue workflow has minimum permissions and no PR lifecycle step', () => {
  const workflow = execFileSync('cat', ['.github/workflows/create-feature-issues.yml'], { encoding: 'utf8' });
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /- all\n\s+- changed/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /pull-requests: write/);
  assert.doesNotMatch(workflow, /open-feature-request-processing-prs/);
});

test('post-merge orchestration explicitly creates issues and dispatches deploy only for runtime files', () => {
  const workflow = execFileSync('cat', ['.github/workflows/post-merge-orchestration.yml'], { encoding: 'utf8' });
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /- closed/);
  assert.match(workflow, /if: github\.event\.pull_request\.merged == true/);
  assert.match(workflow, /requests\\\/features\\\/\[\^\/\]\+\\\.json/);
  assert.match(workflow, /FEATURE_REQUEST_FILES/);
  assert.match(workflow, /gh workflow run deploy-cloudflare\.yml --ref main/);
  assert.match(workflow, /\^\(app\|components\|lib\|public\)/);
  assert.doesNotMatch(workflow, /npm run build:worker/);
  assert.doesNotMatch(workflow, /wrangler deploy/);
});

test('documentation-only merge does not deploy unnecessarily', () => {
  const workflow = execFileSync('cat', ['.github/workflows/post-merge-orchestration.yml'], { encoding: 'utf8' });
  assert.doesNotMatch(workflow, /docs\//);
  assert.match(workflow, /if: steps\.files\.outputs\.runtime_files != ''/);
});

test('auto-merge workflow uses GITHUB_TOKEN and no PAT-backed secret', () => {
  const workflow = execFileSync('cat', ['.github/workflows/auto-merge.yml'], { encoding: 'utf8' });
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /AUTO_MERGE_TOKEN/);
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /github\.event\.pull_request\.draft == false/);
  assert.match(workflow, /REPOSITORY_OWNER: \$\{\{ github\.repository_owner \}\}/);
  assert.match(workflow, /HEAD_REPOSITORY/);
  assert.match(workflow, /gh api --paginate/);
  assert.match(workflow, /\.github\/workflows\//);
  assert.match(workflow, /package\.json/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /actions\/checkout/);
  assert.match(workflow, /--auto --squash --delete-branch/);
});

test('Cloudflare deployment has one explicit dispatch path and remains manually runnable', () => {
  const deploy = execFileSync('cat', ['.github/workflows/deploy-cloudflare.yml'], { encoding: 'utf8' });
  const orchestrator = execFileSync('cat', ['.github/workflows/post-merge-orchestration.yml'], { encoding: 'utf8' });
  assert.match(deploy, /workflow_dispatch:/);
  assert.doesNotMatch(deploy, /push:/);
  assert.match(deploy, /npm run build:worker/);
  assert.match(deploy, /npx wrangler deploy/);
  assert.match(orchestrator, /gh workflow run deploy-cloudflare\.yml --ref main/);
});
