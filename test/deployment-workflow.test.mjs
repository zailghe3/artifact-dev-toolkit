import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { classifyChanges } from '../scripts/classify-changes.mjs';

const read = (path) => readFileSync(path, 'utf8');
const autoMerge = read('.github/workflows/auto-merge.yml');
const manualDeploy = read('.github/workflows/deploy-cloudflare.yml');
const reusableDeploy = read('.github/workflows/reusable-deploy-cloudflare.yml');
const main = read('.github/workflows/main-orchestrator.yml');
const classify = read('.github/workflows/reusable-classify-changes.yml');
const verify = read('.github/workflows/reusable-verify.yml');
const pr = read('.github/workflows/pr-orchestrator.yml');
const runtimePublish = read('.github/workflows/publish-adt-runtime.yml');
const runnerPublish = read('.github/workflows/publish-codex-runner.yml');

test('modified lifecycle workflows remain valid YAML', () => {
  for (const path of [
    '.github/workflows/pr-orchestrator.yml',
    '.github/workflows/main-orchestrator.yml',
    '.github/workflows/reusable-classify-changes.yml',
    '.github/workflows/reusable-verify.yml',
    '.github/workflows/reusable-deploy-cloudflare.yml',
    '.github/workflows/publish-adt-runtime.yml',
    '.github/workflows/publish-codex-runner.yml',
  ]) assert.doesNotThrow(() => parse(read(path)), path);
});

test('automatic merge remains gated by successful PR lifecycle and immutable head checks', () => {
  assert.doesNotMatch(autoMerge, /pull_request_target|--auto/);
  assert.match(autoMerge, /workflow_run:[\s\S]*workflows: \["PR lifecycle"\]/);
  assert.match(autoMerge, /conclusion == 'success'[\s\S]*event == 'pull_request'/);
  assert.match(autoMerge, /--method PUT[\s\S]*-f sha="\$\{VALIDATED_SHA\}"/);
  assert.match(autoMerge, /gh workflow run main-orchestrator\.yml --repo "\$\{REPOSITORY\}" --ref main -f ref="\$\{MERGE_SHA\}"/);
});

test('classifier exposes one operation-level impact contract and fails closed on unknown paths', () => {
  for (const output of [
    'verify_root',
    'verify_app',
    'verify_runtime',
    'verify_runner',
    'verify_integration',
    'smoke_runtime_image',
    'smoke_runner_image',
    'smoke_runner_proxy_policy',
    'deploy_worker',
    'apply_migrations',
    'deploy_cloudflare',
    'publish_runtime',
    'publish_runner',
    'unclassified_files',
    'has_unclassified_changes',
  ]) assert.match(classify, new RegExp(`${output}:`), output);
  assert.match(classify, /Fail closed on unclassified paths/);
  assert.match(classify, /has_unclassified_changes == 'true'/);
});

test('PR lifecycle passes every expensive verification signal into one stable verification workflow', () => {
  assert.match(pr, /needs: classify[\s\S]*uses: \.\/\.github\/workflows\/reusable-verify\.yml/);
  for (const input of [
    'verify_root',
    'verify_app',
    'verify_runtime',
    'verify_runner',
    'verify_integration',
    'smoke_runtime_image',
    'smoke_runner_image',
    'smoke_runner_proxy_policy',
  ]) assert.match(pr, new RegExp(`${input}: \\$\\{\\{ needs\\.classify\\.outputs\\.${input} == 'true' \\}\\}`), input);
  assert.doesNotMatch(pr, /CLOUDFLARE_API_TOKEN|DOCKERHUB_TOKEN|contents: write|pull-requests: write/);
});

test('reusable verification avoids duplicate builds and gates independent Runner proxy work independently', () => {
  assert.doesNotMatch(verify, /name: Build Next\.js app/);
  assert.match(verify, /name: Build OpenNext Cloudflare worker\s+if: inputs\.verify_app/);
  assert.match(verify, /name: Validate ADT Runtime in isolation\s+if: inputs\.verify_runtime[\s\S]*run: npm test/);
  assert.doesNotMatch(verify, /working-directory: adt-runtime[\s\S]{0,120}npm test && npm run typecheck/);
  assert.match(verify, /name: Validate Codex Runner\s+if: inputs\.verify_runner[\s\S]*run: npm test/);
  assert.doesNotMatch(verify, /working-directory: codex-runner[\s\S]{0,120}npm test && npm run typecheck/);
  assert.match(verify, /name: Build Codex Runner image\s+if: inputs\.smoke_runner_image/);
  assert.match(verify, /name: Smoke-test Codex Runner proxy policy\s+if: inputs\.smoke_runner_proxy_policy/);
  assert.match(verify, /verify_integration && inputs\.verify_runtime[\s\S]*node --test test\/integration\/workflow-runtime-integration\.test\.mjs/);
  assert.match(verify, /verify_integration && !inputs\.verify_runtime[\s\S]*test:workflow-runtime-integration/);
});

test('README-only changes select no expensive verification or production mutation', () => {
  const result = classifyChanges([{ filename: 'README.md' }]);
  for (const key of [
    'verify_root', 'verify_app', 'verify_runtime', 'verify_runner', 'verify_integration',
    'smoke_runtime_image', 'smoke_runner_image', 'smoke_runner_proxy_policy',
    'deploy_worker', 'apply_migrations', 'deploy_cloudflare', 'publish_runtime', 'publish_runner',
  ]) assert.equal(result[key], false, key);
});

test('release metadata selects both the Runner image and ADT Worker consumer', () => {
  const result = classifyChanges([{ filename: 'codex-runner/release.json' }]);
  assert.equal(result.publish_runner, true);
  assert.equal(result.deploy_worker, true);
  assert.equal(result.verify_app, true);
  assert.equal(result.verify_runner, true);
});

test('Runner policy-only and stack-only changes do not build an unchanged Runner image', () => {
  const proxy = classifyChanges([{ filename: 'codex-runner/squid.conf' }]);
  assert.equal(proxy.smoke_runner_proxy_policy, true);
  assert.equal(proxy.smoke_runner_image, false);
  assert.equal(proxy.publish_runner, false);
  const stack = classifyChanges([{ filename: 'codex-runner/docker-stack.split.example.yml' }]);
  assert.equal(stack.verify_runner, true);
  assert.equal(stack.smoke_runner_proxy_policy, false);
  assert.equal(stack.smoke_runner_image, false);
});

test('main runs pre-mutation verification only for Cloudflare operations', () => {
  const verifyMain = main.slice(main.indexOf('  verify-main:'), main.indexOf('  create-feature-issues:'));
  assert.match(verifyMain, /if: needs\.classify\.result == 'success' && needs\.classify\.outputs\.deploy_cloudflare == 'true'/);
  assert.match(verifyMain, /verify_app: false/);
  assert.match(verifyMain, /verify_runtime: false/);
  assert.match(verifyMain, /verify_runner: false/);
  assert.match(verifyMain, /verify_integration: \$\{\{ needs\.classify\.outputs\.verify_integration == 'true' \}\}/);
});

test('mixed control-plane and Runtime changes share integration before either production mutation', () => {
  const result = classifyChanges([{ filename: 'lib/adt-runtime-client.ts' }, { filename: 'adt-runtime/src/server.ts' }]);
  assert.equal(result.deploy_worker, true);
  assert.equal(result.publish_runtime, true);
  assert.equal(result.verify_integration, true);
  assert.match(main, /publish-runtime:[\s\S]*needs: \[resolve-context, classify, verify-main\]/);
  assert.match(main, /publish-runtime:[\s\S]*deploy_cloudflare != 'true' \|\| needs\.verify-main\.result == 'success'/);
  assert.match(main, /integration_already_verified: \$\{\{ needs\.classify\.outputs\.deploy_cloudflare == 'true' && needs\.classify\.outputs\.verify_integration == 'true' && needs\.verify-main\.result == 'success' \}\}/);
  assert.match(main, /deploy:[\s\S]*needs\.verify-main\.result == 'success'/);
  assert.match(runtimePublish, /integration_already_verified:[\s\S]*default: false/);
  assert.match(runtimePublish, /if: inputs\.integration_already_verified != true[\s\S]*node --test test\/integration\/workflow-runtime-integration\.test\.mjs/);
});

test('migration-only Cloudflare operation skips Worker metadata, build, and publish', () => {
  const result = classifyChanges([{ filename: 'migrations/0018_example.sql' }]);
  assert.equal(result.deploy_worker, false);
  assert.equal(result.apply_migrations, true);
  assert.match(reusableDeploy, /deploy_worker:[\s\S]*default: true/);
  assert.match(reusableDeploy, /apply_migrations:[\s\S]*default: true/);
  assert.match(reusableDeploy, /name: Generate deployment metadata environment\s+if: inputs\.deploy_worker/);
  assert.match(reusableDeploy, /name: Build OpenNext Cloudflare worker\s+if: inputs\.deploy_worker/);
  assert.match(reusableDeploy, /name: Apply remote D1 migrations\s+if: inputs\.apply_migrations/);
  assert.match(reusableDeploy, /name: Publish to Cloudflare\s+if: inputs\.deploy_worker/);
  assert.match(main, /resolve-deployment-metadata:[\s\S]*deploy_worker == 'true'/);
});

test('Worker deployment keeps migration-before-publish catch-up ordering', () => {
  const migrationIndex = reusableDeploy.indexOf('npx wrangler d1 migrations apply AUTH_SESSIONS_DB --remote');
  const deployIndex = reusableDeploy.indexOf('npx wrangler deploy');
  assert.ok(migrationIndex > 0 && deployIndex > migrationIndex);
  assert.ok(reusableDeploy.indexOf('node scripts/validate-production-bindings.mjs') < reusableDeploy.indexOf('npm run build:worker'));
  assert.match(main, /deploy_worker: \$\{\{ needs\.classify\.outputs\.deploy_worker == 'true' \}\}/);
  assert.match(main, /apply_migrations: \$\{\{ needs\.classify\.outputs\.apply_migrations == 'true' \}\}/);
});

test('release-driven Runner publication waits for the Worker consumer when both are selected', () => {
  assert.match(main, /publish-runner:[\s\S]*needs: \[resolve-context, classify, verify-main, deploy\]/);
  assert.match(main, /deploy_worker != 'true' \|\| needs\.deploy\.result == 'success'/);
});

test('component publishers are reusable exact-commit workflows with component-scoped freshness', () => {
  for (const [name, source, impact] of [['Runtime', runtimePublish, 'publish_runtime'], ['Runner', runnerPublish, 'publish_runner']]) {
    assert.match(source, /workflow_call:[\s\S]*commit_sha:[\s\S]*required: true/, name);
    assert.match(source, /workflow_dispatch:/, name);
    assert.doesNotMatch(source, /\n  push:/, name);
    assert.match(source, /if: github\.ref == 'refs\/heads\/main'/, name);
    assert.match(source, /TARGET_SHA: \$\{\{ inputs\.commit_sha \|\| github\.sha \}\}/, name);
    assert.match(source, /test "\$\(git rev-parse HEAD\)" = "\$\{TARGET_SHA\}"/, name);
    assert.match(source, new RegExp(`${impact}=\\$\\{result\\.${impact}\\}`), name);
    assert.match(source, new RegExp(`${impact}=false[\\s\\S]*has_unclassified_changes=false`), name);
  }
});

test('Runtime publisher avoids duplicate typecheck/build and only skips shared integration when main proved it', () => {
  assert.doesNotMatch(runtimePublish, /npm test && npm run typecheck/);
  assert.match(runtimePublish, /Test exact merged Runtime source in isolation[\s\S]*run: npm test/);
  assert.match(runtimePublish, /integration_already_verified:[\s\S]*default: false/);
  assert.match(runtimePublish, /Test control-plane and ADT Runtime integration using tested Runtime build[\s\S]*node --test test\/integration\/workflow-runtime-integration\.test\.mjs/);
});

test('Runner publisher validates the image but no longer runs unrelated proxy policy smoke', () => {
  assert.doesNotMatch(runnerPublish, /smoke-proxy-policy\.sh/);
  assert.doesNotMatch(runnerPublish, /npm test && npm run typecheck/);
  assert.match(runnerPublish, /Build Codex Runner image/);
  assert.match(runnerPublish, /Smoke-test Codex Runner image/);
});

test('Cloudflare freshness remains aggregate and fails closed on unknown successor paths', () => {
  assert.match(reusableDeploy, /const result = classifyChanges\(files\)/);
  assert.match(reusableDeploy, /deploy_cloudflare=\$\{result\.deploy_cloudflare\}/);
  assert.match(reusableDeploy, /has_unclassified_changes=\$\{result\.has_unclassified_changes\}/);
  assert.match(reusableDeploy, /deploy_cloudflare=false/);
  assert.match(reusableDeploy, /has_unclassified_changes=false/);
});

test('manual Cloudflare deployment remains explicit full historical recovery', () => {
  assert.match(manualDeploy, /default: main/);
  assert.match(manualDeploy, /git rev-parse HEAD/);
  assert.match(manualDeploy, /commit_sha: \$\{\{ needs\.resolve\.outputs\.commit_sha \}\}/);
  assert.match(manualDeploy, /require_current_main: false/);
  assert.match(reusableDeploy, /deploy_worker:[\s\S]*default: true/);
  assert.match(reusableDeploy, /apply_migrations:[\s\S]*default: true/);
});

test('main summary reports each production operation independently', () => {
  assert.match(main, /Deploy Worker:/);
  assert.match(main, /Apply migrations:/);
  assert.match(main, /Publish Runtime:/);
  assert.match(main, /Publish Runner:/);
  assert.match(main, /Cloudflare operation: skipped — Worker and migration inputs unchanged/);
});
