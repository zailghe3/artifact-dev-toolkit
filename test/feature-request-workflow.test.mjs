import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { changedFeatureRequestFiles } from '../scripts/changed-feature-requests.mjs';
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

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('valid request data renders every binding contract value without truncation', () => {
  const rendered = validateFeatureRequestData(validRequest);
  for (const value of [
    validRequest.featureId,
    validRequest.objective,
    validRequest.userContext,
    validRequest.currentBehaviour,
    validRequest.requiredBehaviour,
    ...validRequest.functionalRequirements,
    ...validRequest.acceptanceCriteria,
  ]) assert.ok(rendered.includes(value), `rendered issue omitted: ${value}`);

  const longText = 'Long acceptance detail. '.repeat(1000).trim();
  assert.ok(validateFeatureRequestData({ ...validRequest, acceptanceCriteria: [longText] }).includes(longText));
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

test('missing required feature and orchestration fields fail clearly', () => {
  assert.throws(
    () => validateFeatureRequestData({ ...validRequest, objective: '' }),
    /Missing required feature issue field\(s\): objective \(objective\)/,
  );
  assert.throws(() => validateFeatureRequestData({ ...validRequest, requestId: '' }), /Missing required orchestration field: requestId/);
});

test('multiple request files are supported by the validator without creating issues', () => {
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
    assert.ok(output.includes(`Validated ${first}`));
    assert.ok(output.includes(`Validated ${second}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file validator accepts valid JSON from disk', () => {
  withTempFile('valid.json', validRequest, (file) => {
    assert.ok(validateFeatureRequestFile(file).includes(validRequest.featureId));
  });
});

test('changed request discovery returns added and modified canonical files but not deleted or nested files', () => {
  const root = mkdtempSync(join(tmpdir(), 'feature-request-git-'));
  try {
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.name', 'ADT Test');
    git(root, 'config', 'user.email', 'adt@example.invalid');
    mkdirSync(join(root, 'requests', 'features', 'nested'), { recursive: true });
    writeFileSync(join(root, 'requests', 'features', 'modified.json'), '{}\n');
    writeFileSync(join(root, 'requests', 'features', 'removed.json'), '{}\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'base');
    const base = git(root, 'rev-parse', 'HEAD');

    writeFileSync(join(root, 'requests', 'features', 'modified.json'), '{"changed":true}\n');
    rmSync(join(root, 'requests', 'features', 'removed.json'));
    writeFileSync(join(root, 'requests', 'features', 'added.json'), '{}\n');
    writeFileSync(join(root, 'requests', 'features', 'nested', 'ignored.json'), '{}\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'changes');

    const files = changedFeatureRequestFiles({
      base,
      head: 'HEAD',
      git: (command, args, options) => execFileSync(command, args, { ...options, cwd: root }),
    });
    assert.deepEqual(files.sort(), ['requests/features/added.json', 'requests/features/modified.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('issue lookup searches the immutable request marker across open and closed issues', async () => {
  const helper = await import('../scripts/create-feature-issues-from-requests.mjs');
  const requestId = 'auth-002-private-repository-authorisation';
  assert.equal(helper.issueMarker(requestId), `<!-- feature-request-id: ${requestId} -->`);
  let args;
  const existing = helper.findExistingIssue(requestId, {
    ghExec: (received) => {
      args = received;
      return JSON.stringify([{ number: 7, url: 'https://github.com/example/repo/issues/7' }]);
    },
  });
  assert.equal(existing.number, 7);
  assert.equal(args[0], 'issue');
  assert.equal(args[1], 'list');
  assert.equal(args[args.indexOf('--state') + 1], 'all');
  assert.ok(args[args.indexOf('--search') + 1].includes(helper.issueMarker(requestId)));
});

test('issue creation supports changed and all-files recovery modes', async () => {
  const helper = await import('../scripts/create-feature-issues-from-requests.mjs');
  assert.deepEqual(helper.requestPaths({ env: { FEATURE_REQUEST_MODE: 'changed', FEATURE_REQUEST_FILES: 'requests/features/a.json\nrequests/features/nested/b.json' }, gitExec: () => '' }), ['requests/features/a.json']);
  assert.deepEqual(helper.requestPaths({ env: { FEATURE_REQUEST_MODE: 'all' }, gitExec: () => 'requests/features/a.json\nrequests/features/pending/b.json\nrequests/features/c.json\n' }), ['requests/features/a.json', 'requests/features/c.json']);
});

test('feature issue processing is idempotent, retryable, dry-runnable, and leaves canonical request files in place', async () => {
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
  assert.equal(paths.every((path) => existsSync(path)), true);

  existing.add('ops-002-deployment-identity-footer');
  const retry = helper.processRequests(paths, { ghExec });
  assert.equal(retry.every((result) => result.status === 'skipped'), true);
  assert.equal(created.length, 1);

  existing.delete('ops-002-deployment-identity-footer');
  const dryRun = helper.processRequests(paths, { dryRun: true, ghExec });
  assert.equal(dryRun.some((result) => result.status === 'would-create'), true);
  assert.equal(created.length, 1);
});

test('feature issue processing validates every selected request before any write', async () => {
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

test('reprocess selection accepts canonical files and rejects missing, traversal, nested, and outside paths', async () => {
  const helper = await import('../scripts/reprocess-feature-requests.mjs');
  assert.equal(
    helper.validateSpecificFeaturePath('./requests/features/ops-002-deployment-identity-footer.json'),
    'requests/features/ops-002-deployment-identity-footer.json',
  );
  assert.throws(() => helper.validateSpecificFeaturePath('requests/features/missing.json'), /does not exist/);
  assert.throws(() => helper.validateSpecificFeaturePath('../requests/features/auth-001-github-sign-in.json'), /unsafe/);
  assert.throws(() => helper.validateSpecificFeaturePath('requests/features/nested/example.json'), /requests\/features/);
  assert.throws(() => helper.validateSpecificFeaturePath('docs/example.json'), /requests\/features/);
});

test('reprocess all mode discovers sorted canonical files and handles no files', async () => {
  const helper = await import('../scripts/reprocess-feature-requests.mjs');
  assert.deepEqual(helper.discoverFeaturePaths({ gitExec: () => 'requests/features/z.json\nrequests/features/a.json\nrequests/features/nested/b.json\n' }), ['requests/features/a.json', 'requests/features/z.json']);
  assert.deepEqual(helper.discoverFeaturePaths({ gitExec: () => '' }), []);
});

test('feature issue workflow keeps the minimum read/write permission boundary', () => {
  const workflow = readFileSync('.github/workflows/create-feature-issues.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|actions: write/);
});

test('reprocess workflow is manual-only and isolates issue write permission', () => {
  const workflow = readFileSync('.github/workflows/reprocess-feature-requests.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|push:/);
  assert.match(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|actions: write/);
});
