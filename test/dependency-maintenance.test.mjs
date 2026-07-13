import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dependabot = readFileSync('.github/dependabot.yml', 'utf8');
const workflow = readFileSync('.github/workflows/dependency-maintenance-report.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const script = readFileSync('scripts/maintenance-report.mjs', 'utf8');
const docs = readFileSync('docs/dependency-toolchain-maintenance.md', 'utf8');

test('dependabot groups minor and patch npm updates by compatibility domain', () => {
  for (const group of [
    'next-react-opennext-minor-patch',
    'eslint-typescript-types-minor-patch',
    'tailwind-postcss-minor-patch',
    'cloudflare-tooling-minor-patch',
    'runtime-support-minor-patch',
  ]) {
    assert.match(dependabot, new RegExp(`${group}:[\\s\\S]*update-types:[\\s\\S]*minor[\\s\\S]*patch`));
  }
  for (const dependency of ['next', 'react', 'react-dom', '@opennextjs/cloudflare', 'typescript', 'typescript-eslint', '@types/*', 'tailwindcss', '@tailwindcss/*', 'postcss', 'wrangler']) {
    assert.match(dependabot, new RegExp(dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('dependabot keeps semver-major npm updates intentional', () => {
  assert.match(dependabot, /dependency-name: "\*"[\s\S]*version-update:semver-major/);
});

test('github actions dependabot updates are grouped separately', () => {
  assert.match(dependabot, /package-ecosystem: github-actions[\s\S]*pinned-github-actions-minor-patch/);
});

test('maintenance report workflow is read-only and non-mutating', () => {
  assert.match(workflow, /permissions:[\s\S]*contents: read/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|issues: write/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /npm run maintenance:report \| tee maintenance-report\.md/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
});

test('maintenance report script covers dependency and action drift domains', () => {
  assert.equal(packageJson.scripts['maintenance:report'], 'node scripts/maintenance-report.mjs');
  assert.match(script, /runNpm\(\['outdated', '--json', '--long'\]\)/);
  assert.match(script, /runNpm\(\['view', name, 'deprecated', '--json'\]\)/);
  assert.match(script, /fullShaPattern/);
  assert.match(script, /expectedActions/);
  assert.match(script, /packageManager/);
});

test('maintenance documentation explains baseline grouping exceptions and verification', () => {
  for (const text of [
    'Node.js 24 and npm 11.4.2',
    'Dependabot grouping',
    'Major npm dependency upgrades are ignored',
    'npm run maintenance:report',
    'contents: read',
    'never creates commits, pull requests, or issues',
    'Record intentional exceptions',
  ]) {
    assert.match(docs, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
