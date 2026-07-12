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

test('repair package lock workflow discards validation side effects and restores only package-lock.json', () => {
  const workflow = readFileSync('.github/workflows/repair-package-lock.yml', 'utf8');
  assert.match(workflow, /saved_lockfile="\$\{RUNNER_TEMP\}\/package-lock\.regenerated\.json"/);
  assert.match(workflow, /cp package-lock\.json "\$\{saved_lockfile\}"/);
  assert.match(workflow, /npm run toolchain:validate[\s\S]*npm test[\s\S]*npm run lint[\s\S]*npm run typecheck[\s\S]*npm run build[\s\S]*npm run build:worker[\s\S]*npm run issue:validate/);
  assert.match(workflow, /git reset --hard HEAD/);
  assert.match(workflow, /git clean -fdx/);
  assert.match(workflow, /cp "\$\{SAVED_LOCKFILE\}" package-lock\.json/);
  assert.match(workflow, /mapfile -t changed_files < <\(git diff --name-only\)/);
  assert.match(workflow, /"\$\{changed_files\[0\]\}" != 'package-lock\.json'/);
  assert.doesNotMatch(workflow, /next-env\.d\.ts tsconfig\.json/);
});

test('repair package lock workflow does not push directly to main', () => {
  const workflow = readFileSync('.github/workflows/repair-package-lock.yml', 'utf8');
  assert.match(workflow, /if \[\[ "\$\{TARGET_BRANCH\}" == 'main' \]\]; then/);
  assert.doesNotMatch(workflow, /git push origin "HEAD:\$\{TARGET_BRANCH\}"[\s\S]*Target branch: main/);
  assert.match(workflow, /git push (?:--force-with-lease=[^\n]+ )?origin "HEAD:refs\/heads\/\$\{REPAIR_BRANCH\}"/);
});

test('main package lock repairs use a deterministic repair branch and pull request', () => {
  const workflow = readFileSync('.github/workflows/repair-package-lock.yml', 'utf8');
  assert.match(workflow, /REPAIR_BRANCH: repair\/regenerate-package-lock/);
  assert.match(workflow, /gh pr create[\s\S]*--base main[\s\S]*--head "\$\{REPAIR_BRANCH\}"/);
  assert.match(workflow, /Regenerate package-lock\.json with canonical npm/);
  assert.match(workflow, /canonical Node\.js version from `\.nvmrc` and the exact npm version declared in `package\.json#packageManager`/);
});

test('non-protected package lock repair branches are pushed directly', () => {
  const workflow = readFileSync('.github/workflows/repair-package-lock.yml', 'utf8');
  assert.match(workflow, /case "\$\{TARGET_BRANCH\}" in[\s\S]*main\|repair\/\*\|codex\/\*\|dependabot\/\*/);
  assert.match(workflow, /else\n\s+git push origin "HEAD:\$\{TARGET_BRANCH\}"/);
  assert.match(workflow, /Direct push: completed/);
});

test('repeated main package lock repairs reuse the same open pull request', () => {
  const workflow = readFileSync('.github/workflows/repair-package-lock.yml', 'utf8');
  assert.match(workflow, /gh pr list --head "\$\{REPOSITORY_OWNER\}:\$\{REPAIR_BRANCH\}" --base main --state open/);
  assert.match(workflow, /gh pr edit "\$\{open_pr_number\}"/);
  assert.match(workflow, /--force-with-lease=refs\/heads\/\$\{REPAIR_BRANCH\}:refs\/remotes\/origin\/\$\{REPAIR_BRANCH\}/);
  assert.match(workflow, /refusing to overwrite possibly unrelated work/);
});

test('no-change package lock repairs exit successfully without commit or pull request', () => {
  const workflow = readFileSync('.github/workflows/repair-package-lock.yml', 'utf8');
  assert.match(workflow, /No package-lock\.json changes were generated; nothing will be committed or pushed\./);
  assert.match(workflow, /if git diff --quiet -- package-lock\.json; then\n\s+exit 0\n\s+fi/);
});

test('repair package lock workflow rejects unsafe target refs', () => {
  const workflow = readFileSync('.github/workflows/repair-package-lock.yml', 'utf8');
  assert.match(workflow, /refs\/\*\|tags\/\*/);
  assert.match(workflow, /Commit SHAs are not accepted as target branches/);
  assert.match(workflow, /git check-ref-format --branch "\$\{TARGET_BRANCH\}"/);
  assert.match(workflow, /Branch is not in the permitted repair scope/);
});
