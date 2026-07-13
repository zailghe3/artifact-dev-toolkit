#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const packageJson = json('package.json');
const lock = json('package-lock.json');
const packageManager = packageJson.packageManager ?? '';
const npmVersion = packageManager.match(/^npm@(.+)$/)?.[1] ?? '';
const nodeVersion = read('.nvmrc').trim();
const directDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
const expectedActions = new Map([
  ['actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0', 'actions/checkout@v7.0.0'],
  ['actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e', 'actions/setup-node@v6.4.0'],
]);
const fullShaPattern = /^[0-9a-f]{40}$/;
const actionPattern = /^\s*uses:\s+([^\s#@]+\/[^\s#@]+)@([^\s#]+)(?:\s+#\s+(.+))?\s*$/gm;

const failures = [];
const warnings = [];
const report = [];
function fail(message) { failures.push(message); }
function warn(message) { warnings.push(message); }
function section(title) { report.push(`\n## ${title}`); }
function bullet(message) { report.push(`- ${message}`); }
function runNpm(args) {
  try {
    return { ok: true, text: execFileSync('npm', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    return { ok: false, text: output };
  }
}

section('Canonical toolchain');
bullet(`Node.js baseline: ${nodeVersion} from .nvmrc and .node-version.`);
bullet(`npm baseline: ${npmVersion} from package.json packageManager.`);
if (read('.node-version').trim() !== nodeVersion) fail('.node-version must match .nvmrc.');
if (packageJson.engines?.node !== `${nodeVersion}.x`) fail(`package.json engines.node must be ${nodeVersion}.x.`);
if (packageJson.engines?.npm !== npmVersion) fail(`package.json engines.npm must be ${npmVersion}.`);
if (lock.packageManager && lock.packageManager !== packageManager) fail('package-lock.json packageManager must match package.json packageManager.');
if (lock.packages?.['']?.engines?.node !== packageJson.engines?.node) fail('package-lock root engines.node must match package.json.');
if (lock.packages?.['']?.engines?.npm !== packageJson.engines?.npm) fail('package-lock root engines.npm must match package.json.');
if (lock.packages?.['']?.packageManager && lock.packages[''].packageManager !== packageManager) fail('package-lock root packageManager must match package.json.');

section('GitHub Actions pinning');
for (const file of readdirSync(resolve(repoRoot, '.github/workflows')).filter((name) => /\.ya?ml$/.test(name)).sort()) {
  const path = `.github/workflows/${file}`;
  const body = read(path);
  let count = 0;
  for (const [, action, ref, comment = ''] of body.matchAll(actionPattern)) {
    count += 1;
    const key = `${action}@${ref}`;
    if (!fullShaPattern.test(ref)) fail(`${path} uses unpinned action ${action}@${ref}.`);
    const expectedComment = expectedActions.get(key);
    if (!expectedComment) fail(`${path} uses ${key} without an approved release-comment mapping.`);
    else if (comment.trim() !== expectedComment) fail(`${path} comment for ${key} must be ${expectedComment}.`);
  }
  if (count > 0) bullet(`${path}: ${count} pinned third-party action reference(s).`);
}

section('Direct dependency currency');
const outdatedResult = runNpm(['outdated', '--json', '--long']);
let outdated = {};
if (outdatedResult.text) {
  try {
    const parsed = JSON.parse(outdatedResult.text);
    if (parsed.error) warn(`npm outdated could not query the registry: ${parsed.error.summary ?? parsed.error.code}`);
    else outdated = parsed;
  }
  catch { warn(`Could not parse npm outdated output: ${outdatedResult.text.slice(0, 200)}`); }
}
const directOutdated = Object.entries(outdated).filter(([name]) => directDependencies[name]);
if (directOutdated.length === 0) bullet('No outdated direct dependencies reported by npm outdated.');
else for (const [name, info] of directOutdated) bullet(`${name}: current ${info.current}, wanted ${info.wanted}, latest ${info.latest}.`);

section('Direct dependency deprecations');
let deprecatedCount = 0;
for (const name of Object.keys(directDependencies).sort()) {
  const result = runNpm(['view', name, 'deprecated', '--json']);
  const value = result.text.trim();
  if (!result.ok) {
    warn(`npm view could not query ${name}: ${value.slice(0, 200)}`);
    continue;
  }
  if (!value || value === 'null' || value === 'undefined') continue;
  deprecatedCount += 1;
  bullet(`${name}: ${value.replace(/^"|"$/g, '')}`);
}
if (deprecatedCount === 0) bullet('No deprecated direct packages reported by npm view.');

section('Exceptions');
bullet('Major upgrades are intentionally excluded from Dependabot grouping and should be opened as dedicated migration PRs.');
bullet('Routine reports do not create commits or issues; review this summary and file a normal PR only when action is required.');

if (warnings.length > 0) {
  section('Warnings');
  for (const warning of warnings) bullet(warning);
}
if (failures.length > 0) {
  section('Failures');
  for (const failure of failures) bullet(failure);
}

console.log(report.join('\n').trimStart());
if (failures.length > 0) process.exit(1);
