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

if (errors.length > 0) {
  console.error('Toolchain validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Toolchain validation passed for Node.js ${nodeVersion} and npm ${npmVersion}.`);
