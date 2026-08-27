import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const autoMerge = readFileSync('.github/workflows/auto-merge.yml', 'utf8');
const manualDeploy = readFileSync('.github/workflows/deploy-cloudflare.yml', 'utf8');
const reusableDeploy = readFileSync('.github/workflows/reusable-deploy-cloudflare.yml', 'utf8');
const main = readFileSync('.github/workflows/main-orchestrator.yml', 'utf8');
const classify = readFileSync('.github/workflows/reusable-classify-changes.yml', 'utf8');

test('automatic merge exists only after successful PR lifecycle and is head guarded', () => {
  assert.doesNotMatch(autoMerge, /pull_request_target|--auto/);
  assert.match(autoMerge, /workflow_run:[\s\S]*workflows: \["PR lifecycle"\]/);
  assert.match(autoMerge, /conclusion == 'success'[\s\S]*event == 'pull_request'/);
  assert.match(autoMerge, /--method PUT[\s\S]*-f sha="\$\{VALIDATED_SHA\}"/);
});

test('successful token merge dispatches trusted Main lifecycle for the immutable merge SHA', () => {
  assert.match(autoMerge, /gh workflow run main-orchestrator\.yml --repo "\$\{REPOSITORY\}" --ref main -f ref="\$\{MERGE_SHA\}"/);
  assert.doesNotMatch(autoMerge, /deploy-cloudflare\.yml|Classify production impact/);
  assert.match(autoMerge, /steps\.merge\.outputs\.merged == 'true'/);
});

test('Main lifecycle supports push and explicit immutable target resolution', () => {
  assert.match(main, /push:[\s\S]*branches: \[main\][\s\S]*workflow_dispatch:/);
  assert.match(main, /INPUT_REF: \$\{\{ inputs\.ref \}\}/);
  assert.match(main, /target_sha="\$\{PUSH_TARGET_SHA\}"[\s\S]*base_sha="\$\{PUSH_BASE_SHA\}"/);
  assert.match(main, /parents\[0\]\.sha \/\/ ""/);
});

test('all Main lifecycle consumers use the resolved immutable target', () => {
  assert.match(main, /head_sha: \$\{\{ needs\.resolve-context\.outputs\.target_sha \}\}/);
  assert.match(main, /ref: \$\{\{ needs\.resolve-context\.outputs\.target_sha \}\}/);
  assert.match(main, /COMMIT_SHA: \$\{\{ needs\.resolve-context\.outputs\.target_sha \}\}/);
  assert.match(main, /commit_sha: \$\{\{ needs\.resolve-context\.outputs\.target_sha \}\}/);
  assert.match(main, /Commit: `\$\{\{ needs\.resolve-context\.outputs\.target_sha \}\}`/);
  assert.doesNotMatch(main.slice(main.indexOf('  classify:')), /github\.sha|github\.event\.before/);
  assert.match(classify, /ref: \$\{\{ inputs\.head_sha \|\| github\.sha \}\}/);
});

test('feature issue processing and deployment both require exact-source verification', () => {
  assert.match(main, /create-feature-issues:[\s\S]*needs\.verify-main\.result == 'success'/);
  assert.match(main, /deploy:[\s\S]*needs\.verify-main\.result == 'success'[\s\S]*deployable_changes == 'true'/);
  assert.match(main, /uses: \.\/\.github\/workflows\/reusable-deploy-cloudflare\.yml/);
});

test('Cloudflare deployment verifies its exact input commit', () => {
  assert.match(reusableDeploy, /ref: \$\{\{ inputs\.commit_sha \}\}/);
  assert.match(reusableDeploy, /git rev-parse HEAD/);
  assert.match(reusableDeploy, /test "\$\{checked_out_sha\}" = "\$\{\{ inputs\.commit_sha \}\}"/);
  assert.match(reusableDeploy, /production-cloudflare-deploy-\$\{\{ github\.repository \}\}/);
});

test('manual deployment remains an explicit recovery workflow', () => {
  assert.match(manualDeploy, /default: main/);
  assert.match(manualDeploy, /commit_sha: \$\{\{ needs\.resolve\.outputs\.commit_sha \}\}/);
});
