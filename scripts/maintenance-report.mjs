#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseApprovedActionsManifest, validateWorkflowActionPolicy } from './github-actions-policy.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const packageJson = json('package.json');
const lock = json('package-lock.json');
const packageRoots = [
  { directory: '/', path: '.' },
  { directory: '/adt-runtime', path: 'adt-runtime' },
  { directory: '/codex-runner', path: 'codex-runner' },
].map((root) => {
  const manifest = json(`${root.path}/package.json`);
  return {
    ...root,
    directDependencies: {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    },
  };
});
const packageManager = packageJson.packageManager ?? '';
const npmVersion = packageManager.match(/^npm@(.+)$/)?.[1] ?? '';
const nodeVersion = read('.nvmrc').trim();
const failures = [];
const warnings = [];
const report = [];
function fail(message) { failures.push(message); }
function warn(message) { warnings.push(message); }
function section(title) { report.push(`\n## ${title}`); }
function bullet(message) { report.push(`- ${message}`); }
function runNpm(args, cwd = repoRoot) {
  try {
    return { ok: true, text: execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), errorText: '' };
  } catch (error) {
    return {
      ok: false,
      text: `${error.stdout ?? ''}`.trim(),
      errorText: `${error.stderr ?? ''}`.trim(),
    };
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
const workflows = {};
for (const file of readdirSync(resolve(repoRoot, '.github/workflows')).filter((name) => /\.ya?ml$/.test(name)).sort()) {
  const path = `.github/workflows/${file}`;
  const body = read(path);
  workflows[path] = body;
  const count = [...body.matchAll(/^\s*(?:-\s*)?uses:\s+(?!\.\/|docker:\/\/)[^\s#]+/gm)].length;
  if (count > 0) bullet(`${path}: ${count} pinned third-party action reference(s).`);
}
try {
  const approvals = parseApprovedActionsManifest(read('.github/approved-actions.json'));
  failures.push(...validateWorkflowActionPolicy(workflows, approvals));
} catch (error) {
  fail(error.message);
}

section('Direct dependency currency');
for (const root of packageRoots) {
  const outdatedResult = runNpm(['outdated', '--json', '--long'], resolve(repoRoot, root.path));
  let outdated = {};
  if (outdatedResult.text) {
    try {
      const parsed = JSON.parse(outdatedResult.text);
      if (parsed.error) warn(`${root.directory}: npm outdated could not query the registry: ${parsed.error.summary ?? parsed.error.code}`);
      else outdated = parsed;
    }
    catch { warn(`${root.directory}: could not parse npm outdated output: ${outdatedResult.text.slice(0, 200)}`); }
  }
  else if (!outdatedResult.ok) {
    warn(`${root.directory}: npm outdated failed: ${outdatedResult.errorText.slice(0, 200)}`);
  }
  const directOutdated = Object.entries(outdated).filter(([name]) => root.directDependencies[name]);
  if (directOutdated.length === 0) bullet(`${root.directory}: no outdated direct dependencies reported by npm outdated.`);
  else for (const [name, info] of directOutdated) {
    bullet(`${root.directory}: ${name}: current ${info.current}, wanted ${info.wanted}, latest ${info.latest}.`);
  }
}

section('Direct dependency deprecations');
let deprecatedCount = 0;
for (const root of packageRoots) {
  for (const name of Object.keys(root.directDependencies).sort()) {
    const result = runNpm(['view', name, 'deprecated', '--json'], resolve(repoRoot, root.path));
    const value = result.text.trim();
    if (!result.ok) {
      warn(`${root.directory}: npm view could not query ${name}: ${(value || result.errorText).slice(0, 200)}`);
      continue;
    }
    if (!value || value === 'null' || value === 'undefined') continue;
    deprecatedCount += 1;
    bullet(`${root.directory}: ${name}: ${value.replace(/^"|"$/g, '')}`);
  }
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
