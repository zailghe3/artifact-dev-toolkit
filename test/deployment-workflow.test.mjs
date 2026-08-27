import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const autoMerge = readFileSync('.github/workflows/auto-merge.yml', 'utf8');
const manualDeploy = readFileSync('.github/workflows/deploy-cloudflare.yml', 'utf8');
const reusableDeploy = readFileSync('.github/workflows/reusable-deploy-cloudflare.yml', 'utf8');
const main = readFileSync('.github/workflows/main-orchestrator.yml', 'utf8');
const classify = readFileSync('.github/workflows/reusable-classify-changes.yml', 'utf8');
const pr = readFileSync('.github/workflows/pr-orchestrator.yml', 'utf8');

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
  assert.match(manualDeploy, /git rev-parse HEAD/);
  assert.match(manualDeploy, /commit_sha: \$\{\{ needs\.resolve\.outputs\.commit_sha \}\}/);
  assert.match(manualDeploy, /pull_request_number: \$\{\{ inputs\.pull_request_number \}\}/);
  assert.match(manualDeploy, /require_current_main: false/);
});

test('main deployment is skipped for non-deployable changes and verification failure', () => {
  const deploy = main.slice(main.indexOf('  deploy:'), main.indexOf('  summary:'));
  assert.match(deploy, /needs\.classify\.outputs\.deployable_changes == 'true'/);
  assert.match(deploy, /needs\.verify-main\.result == 'success'/);
  assert.match(main, /Deployment: skipped — no production-affecting changes/);
  assert.match(main, /Deployment: `\$\{\{ needs\.deploy\.result \}\}`/);
});

test('main metadata lookup cannot block deployment when no unique PR exists', () => {
  assert.match(main, /pull_request_number=""/);
  assert.match(main, /if \[\[ "\$\{#matches\[@\]\}" -eq 1 \]\]/);
  assert.match(main, /deployment will continue without PR metadata/);
});

test('Cloudflare implementation and credentials remain outside PR workflows', () => {
  assert.doesNotMatch(pr, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|reusable-deploy-cloudflare/);
  assert.doesNotMatch(main, /npm run build:worker|d1 migrations|npx wrangler|smoke-test-oauth/);
  assert.match(reusableDeploy, /production-cloudflare-deploy-\$\{\{ github\.repository \}\}/);
});

test('remote D1 migrations run before wrangler deploy and block deployment on failure', () => {
  const migrationIndex = reusableDeploy.indexOf('npx wrangler d1 migrations apply AUTH_SESSIONS_DB --remote');
  const deployIndex = reusableDeploy.indexOf('npx wrangler deploy');
  assert.ok(migrationIndex > 0, 'expected remote migration step');
  assert.ok(deployIndex > migrationIndex, 'wrangler deploy must run after migrations');
  assert.doesNotMatch(reusableDeploy.slice(migrationIndex, deployIndex), /continue-on-error:\s*true/);
});

test('production binding validation occurs before Worker build and deploy', () => {
  const validationIndex = reusableDeploy.indexOf('node scripts/validate-production-bindings.mjs');
  assert.ok(validationIndex > 0);
  assert.ok(validationIndex < reusableDeploy.indexOf('npm run build:worker'));
  assert.ok(validationIndex < reusableDeploy.indexOf('npx wrangler deploy'));
});

test('automatic A then automatic B, automatic A then manual B, and manual A then automatic B share one freshness-guarded deployment boundary', () => {
  assert.match(reusableDeploy, /concurrency:[\s\S]*group: production-cloudflare-deploy-\$\{\{ github\.repository \}\}[\s\S]*cancel-in-progress: false/);
  assert.match(reusableDeploy, /current_main="\$\(gh api[\s\S]*git\/ref\/heads\/main[\s\S]*\.object\.sha/);
  assert.match(reusableDeploy, /if \[\[ "\$\{COMMIT_SHA\}" == "\$\{current_main\}" \]\]/);
  assert.match(reusableDeploy, /deploy:[\s\S]*needs: freshness[\s\S]*if: needs\.freshness\.outputs\.current == 'true'/);
  assert.match(reusableDeploy, /require_current_main:[\s\S]*type: boolean[\s\S]*default: true/);
});
