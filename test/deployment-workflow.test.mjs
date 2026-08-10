import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const autoMerge = readFileSync('.github/workflows/auto-merge.yml', 'utf8');
const manualDeploy = readFileSync('.github/workflows/deploy-cloudflare.yml', 'utf8');
const reusableDeploy = readFileSync('.github/workflows/reusable-deploy-cloudflare.yml', 'utf8');
const main = readFileSync('.github/workflows/main-orchestrator.yml', 'utf8');

test('auto-merge dispatches deployment explicitly instead of depending on pull_request.closed', () => {
  assert.doesNotMatch(autoMerge, /closed/);
  assert.match(autoMerge, /workflow_run:/);
  assert.match(autoMerge, /gh workflow run deploy-cloudflare\.yml/);
  assert.match(autoMerge, /-f ref="\$\{MERGE_SHA\}"/);
  assert.match(autoMerge, /-f pull_request_number="\$\{PR_NUMBER\}"/);
});

test('verified deployable pushes to main invoke the reusable Cloudflare deployment', () => {
  assert.match(main, /push:[\s\S]*branches: \[main\]/);
  assert.match(main, /deploy:\n[\s\S]*needs: \[classify, verify-main, resolve-deployment-metadata\]/);
  assert.match(main, /needs\.verify-main\.result == 'success'[\s\S]*needs\.classify\.outputs\.deployable_changes == 'true'/);
  assert.match(main, /uses: \.\/\.github\/workflows\/reusable-deploy-cloudflare\.yml/);
  assert.match(main, /commit_sha: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(main, /commit_sha:.*github\.head_ref|commit_sha:.*pull_request\.head|commit_sha:.*github\.ref/);
  assert.doesNotMatch(main, /npx wrangler deploy/);
  assert.doesNotMatch(main, /workflow run deploy-cloudflare\.yml/);
});

test('main deployment is skipped for non-deployable changes and verification failure', () => {
  const deploy = main.slice(main.indexOf('  deploy:'), main.indexOf('  summary:'));
  assert.match(deploy, /needs\.classify\.outputs\.deployable_changes == 'true'/);
  assert.match(deploy, /needs\.verify-main\.result == 'success'/);
  assert.match(main, /Deployment: skipped — no production-affecting changes/);
  assert.match(main, /Deployment: `\$\{\{ needs\.deploy\.result \}\}`/);
});

test('manual sensitive merges use the push-to-main path while token merges keep explicit dispatch', () => {
  assert.match(main, /on:\n  push:\n    branches: \[main\]/);
  assert.match(autoMerge, /Require manual review for sensitive pull request/);
  assert.match(autoMerge, /steps\.eligibility\.outputs\.eligible != 'true'/);
  assert.match(autoMerge, /gh workflow run deploy-cloudflare\.yml/);
});

test('main metadata lookup cannot block deployment when no unique PR exists', () => {
  assert.match(main, /pull_request_number=""/);
  assert.match(main, /if \[\[ "\$\{#matches\[@\]\}" -eq 1 \]\]/);
  assert.match(main, /deployment will continue without PR metadata/);
});

test('Cloudflare implementation and credentials remain outside PR workflows', () => {
  const pr = readFileSync('.github/workflows/pr-orchestrator.yml', 'utf8');
  assert.doesNotMatch(pr, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|reusable-deploy-cloudflare/);
  assert.doesNotMatch(main, /npm run build:worker|d1 migrations|npx wrangler|smoke-test-oauth/);
  assert.match(reusableDeploy, /production-cloudflare-deploy-\$\{\{ github\.repository \}\}/);
});

test('reusable deployment checks out and verifies exact commit SHA', () => {
  assert.match(reusableDeploy, /commit_sha:[\s\S]*required: true/);
  assert.match(reusableDeploy, /ref: \$\{\{ inputs\.commit_sha \}\}/);
  assert.match(reusableDeploy, /git rev-parse HEAD/);
  assert.match(reusableDeploy, /test "\$\{checked_out_sha\}" = "\$\{\{ inputs\.commit_sha \}\}"/);
});

test('remote D1 migrations run before wrangler deploy and block deployment on failure', () => {
  const migrationIndex = reusableDeploy.indexOf('npx wrangler d1 migrations apply AUTH_SESSIONS_DB --remote');
  const deployIndex = reusableDeploy.indexOf('npx wrangler deploy');
  assert.ok(migrationIndex > 0, 'expected remote migration step');
  assert.ok(deployIndex > migrationIndex, 'wrangler deploy must run after migrations');
  assert.doesNotMatch(reusableDeploy.slice(migrationIndex, deployIndex), /continue-on-error:\s*true/);
});

test('manual deployment resolves immutable SHA and passes required reusable inputs', () => {
  assert.match(manualDeploy, /default: main/);
  assert.match(manualDeploy, /git rev-parse HEAD/);
  assert.match(manualDeploy, /commit_sha: \$\{\{ needs\.resolve\.outputs\.commit_sha \}\}/);
  assert.match(manualDeploy, /pull_request_number: \$\{\{ inputs\.pull_request_number \}\}/);
});

test('production deployment refuses automatic KV provisioning before build and deploy', () => {
  const validationIndex = reusableDeploy.indexOf('node scripts/validate-production-bindings.mjs');
  assert.ok(validationIndex > 0);
  assert.ok(validationIndex < reusableDeploy.indexOf('npm run build:worker'));
  assert.ok(validationIndex < reusableDeploy.indexOf('npx wrangler deploy'));
});
