#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';

const canonicalFeatureRe = /^requests\/features\/[^/]+\.json$/;
const exactSensitive = new Set(['package.json', 'package-lock.json', 'wrangler.jsonc']);
const exactLockfileRepairRelevant = new Set(['package.json', 'package-lock.json', '.nvmrc', '.node-version', '.npmrc', 'npm-shrinkwrap.json']);
const sharedAppRunnerFiles = new Set(['codex-runner/release.json']);

const rootAppBuildFiles = new Set([
  'package.json',
  'package-lock.json',
  'wrangler.jsonc',
  'tsconfig.json',
  'cloudflare-worker.ts',
  '.nvmrc',
  '.npmrc',
  'postcss.config.mjs',
  'postcss.config.js',
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.mjs',
]);

const rootVerificationFiles = new Set([
  ...rootAppBuildFiles,
  '.node-version',
  'cloudflare-env.d.ts',
  'next-env.d.ts',
  'eslint.config.mjs',
]);

const runtimeImageFiles = new Set([
  'adt-runtime/Dockerfile',
  'adt-runtime/package.json',
  'adt-runtime/package-lock.json',
  'adt-runtime/tsconfig.json',
]);

const runnerImageFiles = new Set([
  'codex-runner/Dockerfile',
  'codex-runner/package.json',
  'codex-runner/package-lock.json',
  'codex-runner/tsconfig.json',
  'codex-runner/release.json',
  'codex-runner/gai.conf',
  'codex-runner/git-askpass.sh',
]);

function normalize(path) { return String(path ?? '').replace(/^\.\//, ''); }
export function isCanonicalFeaturePath(path) { return canonicalFeatureRe.test(normalize(path)); }

export function isSensitivePath(path) {
  const p = normalize(path);
  return /(^|\/)AGENTS\.md$/.test(p)
    || p.startsWith('.agents/')
    || p.startsWith('.github/workflows/')
    || p.startsWith('.github/actions/')
    || p.startsWith('scripts/')
    || p.startsWith('lib/')
    || p === 'test/integration/workflow-runtime-integration.test.mjs'
    || exactSensitive.has(p)
    || /^open-next\.config\..+$/.test(p);
}

export function isLockfileRepairRelevantPath(path) {
  const p = normalize(path);
  return exactLockfileRepairRelevant.has(p)
    || p === '.github/dependabot.yml'
    || p.startsWith('.github/dependabot/')
    || p.startsWith('.github/workflows/')
    || p.startsWith('.github/actions/');
}

export function isDocumentationOrRequestPath(path) {
  const p = normalize(path);
  return /(^|\/)AGENTS\.md$/.test(p)
    || p.startsWith('.agents/')
    || p.startsWith('docs/')
    || p.startsWith('specs/')
    || p.startsWith('prompts/')
    || p.startsWith('requests/')
    || p === 'README.md'
    || /^[^/]+\.md$/.test(p)
    || p === 'adt-runtime/README.md'
    || p.startsWith('adt-runtime/docs/')
    || p === 'codex-runner/README.md'
    || p.startsWith('codex-runner/docs/');
}

function isAppBuildPath(path) {
  const p = normalize(path);
  return p.startsWith('app/')
    || p.startsWith('components/')
    || p.startsWith('lib/')
    || p.startsWith('public/')
    || rootAppBuildFiles.has(p)
    || sharedAppRunnerFiles.has(p)
    || /^next\.config\..+$/.test(p)
    || /^open-next\.config\..+$/.test(p)
    || /^postcss\.config\..+$/.test(p)
    || /^tailwind\.config\..+$/.test(p);
}

function isWorkerDeployPath(path) {
  return isAppBuildPath(path);
}

function isMigrationPath(path) {
  return normalize(path).startsWith('migrations/');
}

function isRuntimePath(path) {
  const p = normalize(path);
  return p.startsWith('adt-runtime/') && !isDocumentationOrRequestPath(p);
}

function isRuntimeImagePath(path) {
  const p = normalize(path);
  return p.startsWith('adt-runtime/src/') || runtimeImageFiles.has(p);
}

function isRuntimeImageSmokePath(path) {
  const p = normalize(path);
  return isRuntimeImagePath(p) || p === 'adt-runtime/scripts/smoke-image.sh';
}

function isRunnerPath(path) {
  const p = normalize(path);
  return p.startsWith('codex-runner/') && !isDocumentationOrRequestPath(p);
}

function isRunnerImagePath(path) {
  const p = normalize(path);
  return p.startsWith('codex-runner/src/') || runnerImageFiles.has(p);
}

function isRunnerImageSmokePath(path) {
  const p = normalize(path);
  return isRunnerImagePath(p) || p === 'codex-runner/scripts/smoke-image.sh';
}

function isRunnerProxyPolicySmokePath(path) {
  const p = normalize(path);
  return /^codex-runner\/squid(?:-executor)?\.conf$/.test(p)
    || p === 'codex-runner/scripts/smoke-proxy-policy.sh';
}

function isRootVerificationPath(path) {
  const p = normalize(path);
  return rootVerificationFiles.has(p)
    || isAppBuildPath(p)
    || isMigrationPath(p)
    || p.startsWith('.github/')
    || p.startsWith('scripts/')
    || p.startsWith('test/')
    || p.startsWith('test-fixtures/');
}

function isIntegrationPath(path) {
  const p = normalize(path);
  return p.startsWith('lib/')
    || isRuntimePath(p)
    || p === 'test/integration/workflow-runtime-integration.test.mjs'
    || p === 'package.json'
    || p === 'package-lock.json'
    || p === '.nvmrc';
}

function isKnownPath(path) {
  const p = normalize(path);
  return isDocumentationOrRequestPath(p)
    || p === '.gitignore'
    || p === '.gitkeep'
    || isRootVerificationPath(p)
    || isRuntimePath(p)
    || isRunnerPath(p)
    || p.startsWith('prompts/');
}

function unique(values) { return [...new Set(values.filter(Boolean).map(normalize))].sort(); }

export function classifyChanges(files) {
  const normalized = files
    .map((file) => ({
      filename: normalize(file.filename ?? file.path),
      previous_filename: file.previous_filename ? normalize(file.previous_filename) : undefined,
      status: file.status ?? 'modified',
    }))
    .filter((file) => file.filename);

  const allPaths = unique(normalized.flatMap((file) => [file.filename, file.previous_filename]));
  const canonicalFeatureFiles = unique(allPaths.filter(isCanonicalFeaturePath));
  const sensitiveFiles = unique(allPaths.filter(isSensitivePath));
  const lockfileRepairFiles = unique(allPaths.filter(isLockfileRepairRelevantPath));
  const unclassifiedFiles = unique(allPaths.filter((path) => !isKnownPath(path)));

  const documentationRequestOnly = allPaths.length > 0 && allPaths.every(isDocumentationOrRequestPath);
  const verifyRoot = allPaths.some(isRootVerificationPath);
  const verifyApp = allPaths.some(isAppBuildPath);
  const verifyRuntime = allPaths.some(isRuntimePath);
  const verifyRunner = allPaths.some(isRunnerPath);
  const verifyIntegration = allPaths.some(isIntegrationPath);
  const smokeRuntimeImage = allPaths.some(isRuntimeImageSmokePath);
  const smokeRunnerImage = allPaths.some(isRunnerImageSmokePath);
  const smokeRunnerProxyPolicy = allPaths.some(isRunnerProxyPolicySmokePath);
  const deployWorker = allPaths.some(isWorkerDeployPath);
  const applyMigrations = deployWorker || allPaths.some(isMigrationPath);
  const deployCloudflare = deployWorker || applyMigrations;
  const publishRuntime = allPaths.some(isRuntimeImagePath);
  const publishRunner = allPaths.some(isRunnerImagePath);

  return {
    changed_files: allPaths.join('\n'),
    canonical_feature_files: canonicalFeatureFiles.join('\n'),
    sensitive_files: sensitiveFiles.join('\n'),
    has_changes: allPaths.length > 0,
    has_feature_request_changes: canonicalFeatureFiles.length > 0,
    has_sensitive_changes: sensitiveFiles.length > 0,
    lockfile_repair_files: lockfileRepairFiles.join('\n'),
    has_lockfile_repair_changes: lockfileRepairFiles.length > 0,
    documentation_request_only: documentationRequestOnly,
    verify_root: verifyRoot,
    verify_app: verifyApp,
    verify_runtime: verifyRuntime,
    verify_runner: verifyRunner,
    verify_integration: verifyIntegration,
    smoke_runtime_image: smokeRuntimeImage,
    smoke_runner_image: smokeRunnerImage,
    smoke_runner_proxy_policy: smokeRunnerProxyPolicy,
    deploy_worker: deployWorker,
    apply_migrations: applyMigrations,
    deploy_cloudflare: deployCloudflare,
    publish_runtime: publishRuntime,
    publish_runner: publishRunner,
    unclassified_files: unclassifiedFiles.join('\n'),
    has_unclassified_changes: unclassifiedFiles.length > 0,
    deployable_changes: deployCloudflare,
  };
}

function parseInput(path) {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text);
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function writeOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  const stringValue = typeof value === 'boolean' ? String(value) : String(value ?? '');
  if (out) appendFileSync(out, `${name}<<EOF\n${stringValue}\nEOF` + '\n');
  else console.log(`${name}=${JSON.stringify(stringValue)}`);
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/classify-changes.mjs files.jsonl');
  const result = classifyChanges(parseInput(input));
  for (const [key, value] of Object.entries(result)) writeOutput(key, value);
  console.log(JSON.stringify(result, null, 2));
}
