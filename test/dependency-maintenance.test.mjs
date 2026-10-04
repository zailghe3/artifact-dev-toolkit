import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parse } from 'yaml';

const dependabot = parse(readFileSync('.github/dependabot.yml', 'utf8'));
const workflow = parse(readFileSync('.github/workflows/dependency-maintenance-report.yml', 'utf8'));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const runtimePackageJson = JSON.parse(readFileSync('adt-runtime/package.json', 'utf8'));
const runnerPackageJson = JSON.parse(readFileSync('codex-runner/package.json', 'utf8'));
const expectedNpmRoots = ['/', '/adt-runtime', '/codex-runner'];

test('dependabot supervises exactly the locked npm package roots and keeps majors manual', () => {
  const npmUpdates = dependabot.updates.filter((update) => update['package-ecosystem'] === 'npm');
  assert.deepEqual(npmUpdates.map((update) => update.directory).sort(), expectedNpmRoots);

  for (const root of expectedNpmRoots) {
    const update = npmUpdates.find((candidate) => candidate.directory === root);
    assert.equal(update.schedule.interval, 'weekly');
    assert.equal(update['versioning-strategy'], 'increase-if-necessary');
    assert.ok(update.ignore.some((rule) =>
      rule['dependency-name'] === '*'
      && rule['update-types']?.includes('version-update:semver-major')));
  }
});

test('runtime and runner Dependabot groups cover their routine dependency domains', () => {
  const updates = new Map(dependabot.updates.map((update) => [update.directory, update]));
  const runtimeGroups = updates.get('/adt-runtime').groups;
  const runnerGroups = updates.get('/codex-runner').groups;
  const runtimePatterns = Object.values(runtimeGroups).flatMap((group) => group.patterns);
  const runnerPatterns = Object.values(runnerGroups).flatMap((group) => group.patterns);

  assert.deepEqual(runtimeGroups['openai-provider-minor-patch'].patterns, ['@openai/agents', 'openai']);
  assert.deepEqual(runtimeGroups['langgraph-minor-patch'].patterns, ['@langchain/langgraph', '@langchain/langgraph-checkpoint']);
  assert.deepEqual(runtimeGroups['mcp-minor-patch'].patterns, ['@modelcontextprotocol/sdk']);
  assert.deepEqual(runtimeGroups['runtime-support-minor-patch'].patterns, [
    'zod',
    'ws',
    'undici',
    '@types/ws',
    '@types/node',
    'typescript',
  ]);
  for (const group of [...Object.values(runtimeGroups), ...Object.values(runnerGroups)]) {
    assert.deepEqual(group['update-types'], ['minor', 'patch']);
  }
  for (const dependency of runtimePatterns) {
    assert.ok(runtimePackageJson.dependencies?.[dependency] || runtimePackageJson.devDependencies?.[dependency], `${dependency} should be a direct Runtime dependency`);
  }
  for (const dependency of runnerPatterns) {
    assert.ok(runnerPackageJson.dependencies?.[dependency] || runnerPackageJson.devDependencies?.[dependency], `${dependency} should be a direct Runner dependency`);
  }
  assert.ok(!runtimePatterns.includes('@secureagentics/adrian'));
  assert.deepEqual(runnerPatterns.sort(), ['@types/node', 'typescript']);
});

test('github actions updates are maintained separately from npm dependency groups', () => {
  const actionUpdates = dependabot.updates.filter((update) => update['package-ecosystem'] === 'github-actions');
  assert.equal(actionUpdates.length, 1);
  assert.equal(actionUpdates[0].directory, '/');
  assert.deepEqual(actionUpdates[0].groups['pinned-github-actions-minor-patch']['update-types'], ['minor', 'patch']);
});

test('maintenance report workflow is scheduled or manual, read-only, and caches every npm lockfile', () => {
  assert.ok(workflow.on.workflow_dispatch !== undefined);
  assert.ok(Array.isArray(workflow.on.schedule));
  assert.deepEqual(workflow.permissions, { contents: 'read' });

  const setupNode = workflow.jobs.report.steps.find((step) => step.name === 'Setup Node.js');
  assert.deepEqual(setupNode.with['cache-dependency-path'].trim().split('\n'), [
    'package-lock.json',
    'adt-runtime/package-lock.json',
    'codex-runner/package-lock.json',
  ]);

  const install = workflow.jobs.report.steps.find((step) => step.name === 'Install dependencies');
  assert.deepEqual(install.run.trim().split('\n'), [
    'npm ci',
    'npm --prefix adt-runtime ci',
    'npm --prefix codex-runner ci',
  ]);
});

test('maintenance report inspects and identifies direct dependencies in every npm root', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'adt-maintenance-report-'));
  const callsPath = join(fixture, 'calls.jsonl');
  const fakeNpmPath = join(fixture, 'npm');
  writeFileSync(fakeNpmPath, `#!/bin/sh
printf '%s|%s\\n' "$PWD" "$*" >> "$NPM_CALLS_PATH"
if [ "$1" = outdated ]; then
  printf '%s' '{"typescript":{"current":"5.0.0","wanted":"5.9.0","latest":"7.0.0"}}'
  exit 1
fi
printf '%s' null
`);
  chmodSync(fakeNpmPath, 0o755);

  try {
    const result = spawnSync(process.execPath, ['scripts/maintenance-report.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        NPM_CALLS_PATH: callsPath,
        PATH: `${fixture}${delimiter}${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const root of expectedNpmRoots) {
      assert.match(result.stdout, new RegExp(`${root.replaceAll('/', '\\/')}: typescript: current 5\\.0\\.0, wanted 5\\.9\\.0, latest 7\\.0\\.0\\.`));
    }

    const outdatedRoots = readFileSync(callsPath, 'utf8').trim().split('\n')
      .map((line) => line.split('|'))
      .filter(([, args]) => args.startsWith('outdated '))
      .map(([cwd]) => `/${relative(process.cwd(), cwd)}`.replace('/.', '/'))
      .sort();
    assert.deepEqual(outdatedRoots, expectedNpmRoots);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('maintenance report remains an explicit repository command', () => {
  const command = packageJson.scripts['maintenance:report'];
  assert.equal(typeof command, 'string');
  assert.ok(command.trim().length > 0);
});
