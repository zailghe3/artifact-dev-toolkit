import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { parseApprovedActionsManifest, validateWorkflowActionPolicy } from '../scripts/github-actions-policy.mjs';

const workflowFiles = readdirSync('.github/workflows').filter((file) => /\.ya?ml$/.test(file)).map((file) => `.github/workflows/${file}`).sort();

function workflow(path) { return readFileSync(path, 'utf8'); }

test('third-party workflow actions remain approved, immutable pins', () => {
  const approvals = parseApprovedActionsManifest(readFileSync('.github/approved-actions.json', 'utf8'));
  assert.deepEqual(validateWorkflowActionPolicy(Object.fromEntries(workflowFiles.map((path) => [path, workflow(path)])), approvals), []);
});

test('workflow_run repeats trusted-main eligibility policy before merge and Main dispatch', () => {
  const source = workflow('.github/workflows/auto-merge.yml');
  const boundary = source.indexOf('Enforce trusted auto-merge eligibility at merge boundary');
  const merge = source.indexOf('Atomically squash merge validated head');
  assert.ok(boundary > source.indexOf('Resolve associated pull request safely'));
  assert.ok(merge > boundary);
  assert.match(source.slice(boundary, merge), /gh api --paginate[\s\S]*scripts\/auto-merge-eligibility\.mjs/);
  assert.match(source, /if: steps\.eligibility\.outputs\.eligible == 'true'[\s\S]*-f sha="\$\{VALIDATED_SHA\}"/);
  assert.match(source, /--ref main -f ref="\$\{MERGE_SHA\}"/);
  assert.doesNotMatch(source, /deploy-cloudflare\.yml/);
});

test('workflow_run fails closed for stale heads, forks, non-owners, and non-main PRs', () => {
  const source = workflow('.github/workflows/auto-merge.yml');
  const decision = workflow('scripts/auto-merge-orchestration.mjs');
  assert.match(decision, /pr\.base\?\.ref === 'main'/);
  assert.match(decision, /pr\.user\?\.login !== repositoryOwner/);
  assert.match(decision, /pr\.head\?\.repo\?\.full_name !== repository/);
  assert.match(decision, /pr\.head\?\.sha !== validatedSha/);
  assert.match(source, /-f sha="\$\{VALIDATED_SHA\}"/);
});

test('merge-boundary helper receives complete trusted owner context', () => {
  const source = workflow('.github/workflows/auto-merge.yml');
  const merge = source.slice(source.indexOf('Atomically squash merge validated head'), source.indexOf('Dispatch Main lifecycle'));
  assert.match(merge, /REPOSITORY_OWNER: \$\{\{ github\.repository_owner \}\}/);
  assert.match(merge, /scripts\/auto-merge-orchestration\.mjs current-array\.json/);
});

test('write-capable auto-merge job checks out only trusted main scripts', () => {
  const source = workflow('.github/workflows/auto-merge.yml');
  for (const checkoutBlock of source.matchAll(/uses: actions\/checkout@[\s\S]*?(?=\n      - name:|$)/g)) {
    assert.doesNotMatch(checkoutBlock[0], /pull_request\.head/);
  }
  assert.match(source, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}[\s\S]*persist-credentials: false/);
});

test('PR lifecycle has read-only permissions and never invokes lockfile publication', () => {
  const source = workflow('.github/workflows/pr-orchestrator.yml');
  assert.match(source, /permissions:\n  contents: read\n  pull-requests: read/);
  assert.doesNotMatch(source, /repair-package-lock|contents: write|pull-requests: write/);
});

test('package-lock repair is maintainer-triggered and executes trusted main only', () => {
  const source = workflow('.github/workflows/repair-package-lock.yml');
  assert.match(source, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(source, /workflow_call:|pull_request:|target_branch|head\.sha/);
  assert.match(source, /Check out trusted main[\s\S]*ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(source, /test "\$\{DEFAULT_BRANCH\}" = main/);
  assert.ok(source.indexOf('Verify trusted source') < source.indexOf('npm install'));
});

test('non-main workflow dispatch cannot reach the write-capable lockfile repair job', () => {
  const source = workflow('.github/workflows/repair-package-lock.yml');
  const publisher = source.slice(source.indexOf('  publish-trusted-repair:'));

  assert.match(publisher, /publish-trusted-repair:\n    name: publish trusted package-lock repair\n    if: github\.ref == 'refs\/heads\/main'\n    runs-on:/);
  assert.ok(publisher.indexOf("if: github.ref == 'refs/heads/main'") < publisher.indexOf('steps:'));
});

test('trusted lockfile publisher bounds and publishes only package-lock.json', () => {
  const source = workflow('.github/workflows/repair-package-lock.yml');
  assert.match(source, /max_bytes=\$\(\(5 \* 1024 \* 1024\)\)/);
  assert.match(source, /changed_files\[0\].*package-lock\.json/);
  assert.match(source, /git diff --check/);
  assert.match(source, /git add package-lock\.json/);
  assert.match(source, /test "\$\(git diff --cached --name-only\)" = package-lock\.json/);
});

test('all non-publishing checkout steps disable persisted credentials', () => {
  for (const path of workflowFiles.filter((path) => !path.endsWith('/repair-package-lock.yml'))) {
    const source = workflow(path);
    const checkoutCount = (source.match(/uses: actions\/checkout@/g) ?? []).length;
    const disabledCount = (source.match(/persist-credentials: false/g) ?? []).length;
    assert.equal(disabledCount, checkoutCount, path);
  }
});
