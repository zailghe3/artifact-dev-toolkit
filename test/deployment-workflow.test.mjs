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

test('classifier exposes one component-impact contract and fails closed on unknown paths', () => {
  for (const output of [
    'verify_root',
    'verify_app',
    'verify_runtime',
    'verify_runner',
    'verify_integration',
    'smoke_runtime_image',
    'smoke_runner_image',
    'deploy_cloudflare',
    'publish_runtime',
    'publish_runner',
    'unclassified_files',
    'has_unclassified_changes',
  ]) assert.match(classify, new RegExp(`${output}:`), output);
  assert.match(classify, /Fail closed on unclassified paths/);
  assert.match(classify, /has_unclassified_changes == 'true'/);
});

test('PR lifecycle passes component impact into one stable verification workflow', () => {
  assert.match(pr, /needs: classify[\s\S]*uses: \.\/\.github\/workflows\/reusable-verify\.yml/);
  for (const input of [
    'verify_root',
    'verify_app',
    'verify_runtime',
    'verify_runner',
    'verify_integration',
    'smoke_runtime_image',
    'smoke_runner_image',
  ]) assert.match(pr, new RegExp(`${input}: \\$\\{\\{ needs\\.classify\\.outputs\\.${input} == 'true' \\}\\}`), input);
  assert.doesNotMatch(pr, /CLOUDFLARE_API_TOKEN|DOCKERHUB_TOKEN|contents: write|pull-requests: write/);
});

test('reusable verification conditionally gates expensive component work', () => {
  assert.match(verify, /name: Build Next\.js app\s+if: inputs\.verify_app/);
  assert.match(verify, /name: Build OpenNext Cloudflare worker\s+if: inputs\.verify_app/);
  assert.match(verify, /name: Validate ADT Runtime in isolation\s+if: inputs\.verify_runtime/);
  assert.match(verify, /name: Validate Codex Runner\s+if: inputs\.verify_runner/);
  assert.match(verify, /name: Test control-plane and ADT Runtime integration\s+if: inputs\.verify_integration/);
  assert.match(verify, /name: Build Codex Runner image\s+if: inputs\.smoke_runner_image/);
  assert.match(verify, /name: Build and smoke-test ADT Runtime image without publishing\s+if: inputs\.smoke_runtime_image/);
  assert.match(verify, /name: Summarize selected verification\s+if: always\(\)/);
});

test('README-only changes select no expensive verification or production mutation', () => {
  const result = classifyChanges([{ filename: 'README.md' }]);
  assert.equal(result.documentation_request_only, true);
  assert.equal(result.verify_root, false);
  assert.equal(result.verify_app, false);
  assert.equal(result.verify_runtime, false);
  assert.equal(result.verify_runner, false);
  assert.equal(result.verify_integration, false);
  assert.equal(result.smoke_runtime_image, false);
  assert.equal(result.smoke_runner_image, false);
  assert.equal(result.deploy_cloudflare, false);
  assert.equal(result.publish_runtime, false);
  assert.equal(result.publish_runner, false);
});

test('Main lifecycle uses the same classification for each automatic production mutation', () => {
  assert.match(main, /classify-main[\s\S]*reusable-classify-changes\.yml/);
  assert.match(main, /deploy:[\s\S]*needs\.classify\.outputs\.deploy_cloudflare == 'true'[\s\S]*reusable-deploy-cloudflare\.yml/);
  assert.match(main, /publish-runtime:[\s\S]*needs\.classify\.outputs\.publish_runtime == 'true'[\s\S]*publish-adt-runtime\.yml/);
  assert.match(main, /publish-runner:[\s\S]*needs\.classify\.outputs\.publish_runner == 'true'[\s\S]*publish-codex-runner\.yml/);
});

test('Main avoids duplicate component and app image builds before publishers/deployer own them', () => {
  const verifyMain = main.slice(main.indexOf('  verify-main:'), main.indexOf('  create-feature-issues:'));
  assert.match(verifyMain, /verify_app: false/);
  assert.match(verifyMain, /verify_runtime: false/);
  assert.match(verifyMain, /verify_runner: false/);
  assert.match(verifyMain, /smoke_runtime_image: false/);
  assert.match(verifyMain, /smoke_runner_image: false/);
  assert.match(verifyMain, /verify_root: \$\{\{ needs\.classify\.outputs\.deploy_cloudflare == 'true' \}\}/);
});

test('component publishers are reusable exact-commit workflows rather than independent push path taxonomies', () => {
  for (const [name, source] of [['Runtime', runtimePublish], ['Runner', runnerPublish]]) {
    assert.match(source, /workflow_call:[\s\S]*commit_sha:[\s\S]*required: true/);
    assert.match(source, /workflow_dispatch:/);
    assert.doesNotMatch(source, /\n  push:/, name);
    assert.match(source, /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(source, /TARGET_SHA: \$\{\{ inputs\.commit_sha \|\| github\.sha \}\}/);
    assert.match(source, /test "\$\(git rev-parse HEAD\)" = "\$\{TARGET_SHA\}"/);
  }
});

test('component publisher freshness blocks newer image inputs but allows unrelated successors', () => {
  assert.match(runtimePublish, /publish_runtime=\$\{result\.publish_runtime\}/);
  assert.match(runtimePublish, /publish_runtime=false[\s\S]*has_unclassified_changes=false/);
  assert.match(runnerPublish, /publish_runner=\$\{result\.publish_runner\}/);
  assert.match(runnerPublish, /publish_runner=false[\s\S]*has_unclassified_changes=false/);
});

test('Cloudflare deployment freshness is scoped to newer Cloudflare impact and fails closed on unknown paths', () => {
  assert.match(reusableDeploy, /const result = classifyChanges\(files\)/);
  assert.match(reusableDeploy, /deploy_cloudflare=\$\{result\.deploy_cloudflare\}/);
  assert.match(reusableDeploy, /has_unclassified_changes=\$\{result\.has_unclassified_changes\}/);
  assert.match(reusableDeploy, /deploy_cloudflare=false/);
  assert.match(reusableDeploy, /has_unclassified_changes=false/);
  assert.doesNotMatch(reusableDeploy, /deployable_changes=/);
});

test('manual Cloudflare deployment remains explicit historical recovery', () => {
  assert.match(manualDeploy, /default: main/);
  assert.match(manualDeploy, /git rev-parse HEAD/);
  assert.match(manualDeploy, /commit_sha: \$\{\{ needs\.resolve\.outputs\.commit_sha \}\}/);
  assert.match(manualDeploy, /require_current_main: false/);
});

test('Cloudflare deployment still verifies exact source and migrates before deployment', () => {
  assert.match(reusableDeploy, /ref: \$\{\{ inputs\.commit_sha \}\}/);
  assert.match(reusableDeploy, /test "\$\{checked_out_sha\}" = "\$\{\{ inputs\.commit_sha \}\}"/);
  const migrationIndex = reusableDeploy.indexOf('npx wrangler d1 migrations apply AUTH_SESSIONS_DB --remote');
  const deployIndex = reusableDeploy.indexOf('npx wrangler deploy');
  assert.ok(migrationIndex > 0 && deployIndex > migrationIndex);
  assert.ok(reusableDeploy.indexOf('node scripts/validate-production-bindings.mjs') < reusableDeploy.indexOf('npm run build:worker'));
});

test('main summary reports each production artifact independently', () => {
  assert.match(main, /Deploy Cloudflare:/);
  assert.match(main, /Publish Runtime:/);
  assert.match(main, /Publish Runner:/);
  assert.match(main, /Cloudflare deployment: skipped — Worker inputs unchanged/);
  assert.match(main, /ADT Runtime publication: skipped — image inputs unchanged/);
  assert.match(main, /Codex Runner publication: skipped — image inputs unchanged/);
});
