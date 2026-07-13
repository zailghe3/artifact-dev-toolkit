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

test('only trusted auto-merge performs automatic Cloudflare deployment handoff', () => {
  assert.doesNotMatch(main, /reusable-deploy-cloudflare\.yml/);
  assert.doesNotMatch(main, /npx wrangler deploy/);
  assert.doesNotMatch(main, /workflow run deploy-cloudflare\.yml/);
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
