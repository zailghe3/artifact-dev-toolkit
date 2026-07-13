#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');
const trim = (path) => read(path).trim();
const packageJson = JSON.parse(read('package.json'));
const nodeVersion = trim('.nvmrc');
const nodeVersionMirror = trim('.node-version');
const npmVersion = packageJson.packageManager?.match(/^npm@(.+)$/)?.[1];

function fail(message) { errors.push(message); }
function expectEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} must be ${expected}; found ${actual || '<missing>'}.`);
}

expectEqual(nodeVersion, '24', '.nvmrc');
expectEqual(nodeVersionMirror, nodeVersion, '.node-version');
expectEqual(packageJson.engines?.node, `${nodeVersion}.x`, 'package.json engines.node');
expectEqual(packageJson.engines?.npm, npmVersion, 'package.json engines.npm');
expectEqual(packageJson.packageManager, 'npm@11.4.2', 'package.json packageManager');

const lock = JSON.parse(read('package-lock.json'));
expectEqual(lock.packages?.['']?.engines?.node, packageJson.engines.node, 'package-lock root engines.node');
expectEqual(lock.packages?.['']?.engines?.npm, packageJson.engines.npm, 'package-lock root engines.npm');

if (lock.packageManager && lock.packageManager !== packageJson.packageManager) fail('package-lock.json packageManager must match package.json packageManager.');
if (lock.packages?.['']?.packageManager && lock.packages[''].packageManager !== packageJson.packageManager) fail('package-lock root packageManager must match package.json packageManager.');
expectEqual(lock.packages?.['']?.devDependencies ? lock.packages[''].name : lock.name, packageJson.name, 'package-lock root package');

for (const workflow of ['.github/workflows/reusable-validate-feature-requests.yml', '.github/workflows/reusable-create-feature-issues.yml', '.github/workflows/reusable-deploy-cloudflare.yml', '.github/workflows/repair-package-lock.yml', '.github/workflows/reprocess-feature-requests.yml', '.github/workflows/reusable-verify.yml']) {
  const body = read(workflow);
  if (!body.includes('node-version-file: .nvmrc')) fail(`${workflow} must use node-version-file: .nvmrc.`);
  if (/node-version:\s*['\"]?\d+/.test(body)) fail(`${workflow} must not hard-code a numeric node-version.`);
  if (/npm install -g npm@\d/.test(body)) fail(`${workflow} must install npm from package.json packageManager.`);
}

for (const path of ['README.md', 'docs/development-workflow.md', 'docs/codex-create-feature-request.md', '.github/ISSUE_TEMPLATE/shared/codex-execution-contract.md', '.github/ISSUE_TEMPLATE/feature.yml']) {
  const body = read(path);
  if (!body.includes('Node.js 24') && !body.includes('Node.js `${nodeVersion}`')) fail(`${path} must document Node.js 24.`);
  if (!body.includes('npm 11') && !body.includes('npm `${npmVersion}`')) fail(`${path} must document npm 11.`);
  if (/Node\.js 22|npm 10\.9\.7|node-version:\s*22/.test(body)) fail(`${path} still references the previous Node.js/npm baseline.`);
}

const fullShaPattern = /^[0-9a-f]{40}$/;
const expectedActionReleases = new Map([
  ['actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0', 'actions/checkout@v7.0.0'],
  ['actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e', 'actions/setup-node@v6.4.0'],
]);
const actionPattern = /^\s*uses:\s+([^\s#@]+\/[^\s#@]+)@([^\s#]+)(?:\s+#\s+(.+))?\s*$/gm;
for (const workflow of ['.github/workflows/auto-merge.yml', '.github/workflows/create-feature-issues.yml', '.github/workflows/dependency-maintenance-report.yml', '.github/workflows/deploy-cloudflare.yml', '.github/workflows/main-orchestrator.yml', '.github/workflows/pr-orchestrator.yml', '.github/workflows/repair-package-lock.yml', '.github/workflows/reprocess-feature-requests.yml', '.github/workflows/reusable-classify-changes.yml', '.github/workflows/reusable-create-feature-issues.yml', '.github/workflows/reusable-deploy-cloudflare.yml', '.github/workflows/reusable-validate-feature-requests.yml', '.github/workflows/reusable-verify.yml']) {
  const body = read(workflow);
  for (const [, action, ref, comment = ''] of body.matchAll(actionPattern)) {
    const key = `${action}@${ref}`;
    if (!fullShaPattern.test(ref)) fail(`${workflow} must pin ${action} to a full commit SHA.`);
    if (comment.trim() !== expectedActionReleases.get(key)) fail(`${workflow} must document the approved release tag for ${key}.`);
  }
}

if (errors.length > 0) {
  console.error('Toolchain validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Toolchain validation passed for Node.js ${nodeVersion} and npm ${npmVersion}.`);
