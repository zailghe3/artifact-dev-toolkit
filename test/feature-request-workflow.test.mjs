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

test('rendered feature issues include the shared Codex contract exactly once', async () => {
  const { renderFeatureIssue } = await import('../scripts/render-feature-issue.mjs');
  const rendered = renderFeatureIssue(validRequest);
  assert.equal((rendered.match(/## Codex execution contract/g) ?? []).length, 1);
  assert.match(rendered, /normal functional implementation PRs, not include unrelated dependency, framework, runtime, compiler, linting, deployment-tool, or GitHub Actions upgrades/);
});

test('Codex contract captures functional validation, dependency, lockfile, and PR reporting requirements', () => {
  const contract = execFileSync('cat', ['.github/ISSUE_TEMPLATE/shared/codex-execution-contract.md'], { encoding: 'utf8' });

  for (const command of [
    'npm ci',
    'npm run toolchain:validate',
    'npm test',
    'npm run lint',
    'npm run typecheck',
    'npm run build',
    'npm run build:worker',
    'git diff --check',
  ]) {
    assert.match(contract, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(contract, /`Closes #<issue-number>`/);
  assert.match(contract, /passed, failed, not run because inapplicable, or not run or incomplete because of an environment restriction/);
  assert.match(contract, /never report a failed or unavailable command as passed/);
  assert.match(contract, /not include unrelated dependency, framework, runtime, compiler, linting, deployment-tool, or GitHub Actions upgrades/);
  assert.match(contract, /docs\/dependency-toolchain-maintenance\.md/);
  assert.match(contract, /docs\/dev-007-typescript-7-assessment\.md/);
  assert.match(contract, /`npm audit` and `npm audit --omit=dev`/);
  assert.match(contract, /report it as \*\*not completed\*\* with the reason/);
  assert.match(contract, /never describe an unavailable audit as passed or clean/);
  assert.match(contract, /generate `package-lock\.json` through npm rather than manually editing lockfile internals/);
  assert.match(contract, /package-lock repair architecture that resets validation side effects and restores only the npm-regenerated lockfile/);
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
  assert.match(source, /validateSelectedRequests/);
  assert.match(source, /findExistingIssue\(request\.requestId/);
  assert.match(source, /status: 'skipped'/);
  assert.match(source, /status: 'created'/);
});

test('feature issue workflow has minimum permissions and no PR lifecycle step', () => {
  const workflow = execFileSync('cat', ['.github/workflows/create-feature-issues.yml'], { encoding: 'utf8' });
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /- all\n\s+- changed|options: \[all, changed\]/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /pull-requests: write/);
  assert.doesNotMatch(workflow, /open-feature-request-processing-prs/);
});

test('main orchestration verifies before independent issue creation; deployment is dispatched by trusted auto-merge', () => {
  const workflow = execFileSync('cat', ['.github/workflows/main-orchestrator.yml'], { encoding: 'utf8' });
  assert.match(workflow, /push:/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /verify-main:/);
  assert.match(workflow, /create-feature-issues:/);
  assert.match(workflow, /needs: \[classify, verify-main\]/);
  assert.match(workflow, /reusable-create-feature-issues\.yml/);
  assert.doesNotMatch(workflow, /reusable-deploy-cloudflare\.yml/);
  assert.doesNotMatch(workflow, /gh workflow run/);
});

test('documentation-only merge skip logic is narrow and classification-driven', () => {
  const classifier = execFileSync('cat', ['scripts/classify-changes.mjs'], { encoding: 'utf8' });
  assert.match(classifier, /deployable_changes/);
  assert.match(classifier, /docs\//);
  assert.match(classifier, /requests\/features\//);
  assert.match(classifier, /README\.md/);
});

test('auto-merge workflow uses GITHUB_TOKEN and no PAT-backed secret', () => {
  const workflow = execFileSync('cat', ['.github/workflows/auto-merge.yml'], { encoding: 'utf8' });
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /AUTO_MERGE_TOKEN/);
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /IS_DRAFT|github\.event\.pull_request\.draft/);
  assert.match(workflow, /REPOSITORY_OWNER: \$\{\{ github\.repository_owner \}\}/);
  assert.match(workflow, /HEAD_REPOSITORY/);
  assert.match(workflow, /gh api --paginate/);
  assert.match(workflow, /scripts\/auto-merge-eligibility\.mjs/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /pull-requests: write/);
  assert.doesNotMatch(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /AUTO_MERGE_TOKEN/);
  assert.match(workflow, /Check out trusted base scripts/);
  assert.match(workflow, /--auto --squash --delete-branch/);
});

test('Cloudflare deployment uses reusable workflow and remains manually runnable', () => {
  const deploy = execFileSync('cat', ['.github/workflows/deploy-cloudflare.yml'], { encoding: 'utf8' });
  const reusable = execFileSync('cat', ['.github/workflows/reusable-deploy-cloudflare.yml'], { encoding: 'utf8' });
  const orchestrator = execFileSync('cat', ['.github/workflows/main-orchestrator.yml'], { encoding: 'utf8' });
  assert.match(deploy, /workflow_dispatch:/);
  assert.match(deploy, /ref:/);
  assert.doesNotMatch(deploy, /push:/);
  assert.match(deploy, /reusable-deploy-cloudflare\.yml/);
  assert.match(reusable, /npm run build:worker/);
  assert.match(reusable, /npx wrangler deploy/);
  assert.match(reusable, /environment: production/);
  assert.doesNotMatch(orchestrator, /reusable-deploy-cloudflare\.yml/);
  assert.doesNotMatch(orchestrator, /gh workflow run/);
});

test('reprocess selection accepts a valid specific feature file', async () => {
  const helper = await import('../scripts/reprocess-feature-requests.mjs');
  assert.equal(
    helper.validateSpecificFeaturePath('./requests/features/ops-002-deployment-identity-footer.json'),
    'requests/features/ops-002-deployment-identity-footer.json',
  );
});

test('reprocess selection rejects missing, traversal, and outside paths', async () => {
  const helper = await import('../scripts/reprocess-feature-requests.mjs');
  assert.throws(() => helper.validateSpecificFeaturePath('requests/features/missing.json'), /does not exist/);
  assert.throws(() => helper.validateSpecificFeaturePath('../requests/features/auth-001-github-sign-in.json'), /unsafe/);
  assert.throws(() => helper.validateSpecificFeaturePath('docs/example.json'), /requests\/features/);
});

test('reprocess all mode discovers sorted canonical files and handles no files', async () => {
  const helper = await import('../scripts/reprocess-feature-requests.mjs');
  assert.deepEqual(helper.discoverFeaturePaths({ gitExec: () => 'requests/features/z.json\nrequests/features/a.json\nrequests/features/nested/b.json\n' }), ['requests/features/a.json', 'requests/features/z.json']);
  assert.deepEqual(helper.discoverFeaturePaths({ gitExec: () => '' }), []);
});

test('feature issue processing skips existing issues, creates missing issues, supports partial recovery and dry run', async () => {
  const helper = await import('../scripts/create-feature-issues-from-requests.mjs');
  const existingUrl = 'https://github.com/example/repo/issues/7';
  const created = [];
  const existing = new Set(['auth-001-github-sign-in']);
  const ghExec = (args) => {
    if (args[0] === 'issue' && args[1] === 'list') {
      const requestId = String(args[args.indexOf('--search') + 1]).match(/feature-request-id: ([^ ]+)/)[1];
      return existing.has(requestId) ? JSON.stringify([{ number: 7, url: existingUrl }]) : '[]';
    }
    if (args[0] === 'label') return '';
    if (args[0] === 'issue' && args[1] === 'create') {
      created.push(args);
      return `https://github.com/example/repo/issues/${20 + created.length}`;
    }
    throw new Error(`unexpected gh args: ${args.join(' ')}`);
  };

  const paths = ['requests/features/auth-001-github-sign-in.json', 'requests/features/ops-002-deployment-identity-footer.json'];
  const first = helper.processRequests(paths, { ghExec });
  assert.equal(first.filter((result) => result.status === 'created').length, 1);
  assert.equal(first.filter((result) => result.status === 'skipped').length, 1);
  assert.equal(created.length, 1);

  existing.add('ops-002-deployment-identity-footer');
  const second = helper.processRequests(paths, { ghExec });
  assert.equal(second.every((result) => result.status === 'skipped'), true);
  assert.equal(created.length, 1);

  existing.delete('ops-002-deployment-identity-footer');
  const dryRun = helper.processRequests(paths, { dryRun: true, ghExec });
  assert.equal(dryRun.some((result) => result.status === 'would-create'), true);
  assert.equal(created.length, 1);
});

test('feature issue processing validates all requests before any write and rejects duplicate ids', async () => {
  const helper = await import('../scripts/create-feature-issues-from-requests.mjs');
  assert.throws(
    () => helper.processRequests(['requests/features/auth-001-github-sign-in.json', 'requests/features/auth-001-github-sign-in.json'], { ghExec: () => '[]' }),
    /Duplicate requestId/,
  );
  let writes = 0;
  assert.throws(
    () => helper.processRequests(['requests/features/auth-001-github-sign-in.json', 'requests/features/missing.json'], { ghExec: () => { writes += 1; return '[]'; } }),
    /Unable to read|ENOENT/,
  );
  assert.equal(writes, 0);
});

test('reprocess workflow is manual-only, checks out main, isolates write permission, and documents dry run', () => {
  const workflow = execFileSync('cat', ['.github/workflows/reprocess-feature-requests.yml'], { encoding: 'utf8' });
  assert.match(workflow, /name: Reprocess feature requests/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|push:/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /reusable-verify\.yml/);
  assert.match(workflow, /reusable-create-feature-issues\.yml/);
  assert.match(workflow, /issues: read/);
  assert.match(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|actions: write/);
  assert.match(workflow, /cancel-in-progress: false/);
});
