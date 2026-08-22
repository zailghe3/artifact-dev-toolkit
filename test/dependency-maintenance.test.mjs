import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dependabot = readFileSync('.github/dependabot.yml', 'utf8');
const workflow = readFileSync('.github/workflows/dependency-maintenance-report.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

test('dependabot groups routine npm updates by compatibility domain', () => {
  for (const group of [
    'next-react-opennext-minor-patch',
    'eslint-typescript-types-minor-patch',
    'tailwind-postcss-minor-patch',
    'cloudflare-tooling-minor-patch',
    'runtime-support-minor-patch',
  ]) {
    assert.match(dependabot, new RegExp(`${group}:[\\s\\S]*update-types:[\\s\\S]*minor[\\s\\S]*patch`));
  }
});

test('dependabot keeps semver-major npm updates outside routine groups', () => {
  assert.match(dependabot, /dependency-name: "\*"[\s\S]*version-update:semver-major/);
});

test('github actions updates are maintained separately from npm dependency groups', () => {
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(dependabot, /update-types:[\s\S]*minor[\s\S]*patch/);
});

test('maintenance report workflow is scheduled or manual, read-only, and non-mutating', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /permissions:[\s\S]*contents: read/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|issues: write/);
});

test('maintenance report remains an explicit repository command', () => {
  const command = packageJson.scripts['maintenance:report'];
  assert.equal(typeof command, 'string');
  assert.ok(command.trim().length > 0);
});
