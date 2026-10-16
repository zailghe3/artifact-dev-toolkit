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
const adrianPublish = read('.github/workflows/publish-adrian.yml');
const freshnessPolicy = read('scripts/evaluate-deployment-freshness.mjs');

test('modified lifecycle workflows remain valid YAML', () => {
  for (const path of [
    '.github/workflows/pr-orchestrator.yml',
    '.github/workflows/main-orchestrator.yml',
    '.github/workflows/reusable-classify-changes.yml',
    '.github/workflows/reusable-verify.yml',
    '.github/workflows/reusable-deploy-cloudflare.yml',
    '.github/workflows/publish-adt-runtime.yml',
    '.github/workflows/publish-codex-runner.yml',
    '.github/workflows/publish-adrian.yml',
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
    'runner_release_barrier',
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

test('release metadata selects both the Runner image and ADT Worker consumer with a release barrier', () => {
  const result = classifyChanges([{ filename: 'codex-runner/release.json' }]);
  assert.equal(result.publish_runner, true);
  assert.equal(result.deploy_worker, true);
  assert.equal(result.verify_app, true);
  assert.equal(result.verify_runner, true);
  assert.equal(result.runner_release_barrier, true);
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
  assert.deepEqual(parse(main).jobs['publish-runtime'].needs, ['resolve-context', 'classify', 'verify-main', 'deploy']);
  assert.match(main, /integration_already_verified: \$\{\{ needs\.classify\.outputs\.deploy_cloudflare == 'true' && needs\.classify\.outputs\.verify_integration == 'true' && needs\.verify-main\.result == 'success' \}\}/);
  assert.match(main, /deploy:[\s\S]*needs\.verify-main\.result == 'success'/);
  assert.match(runtimePublish, /integration_already_verified:[\s\S]*default: false/);
  assert.match(runtimePublish, /if: inputs\.integration_already_verified != true[\s\S]*node --test test\/integration\/workflow-runtime-integration\.test\.mjs/);
});

// This workflow condition uses only GitHub's boolean/string expression subset,
// which can be evaluated directly to test publication decisions across outcomes.
function runtimePublicationAllowed(impact, { verification = 'success', deployment = 'success', worker = '', migrations = '', classification = 'success' } = {}) {
  const expression = parse(main).jobs['publish-runtime'].if.replace(/\bneeds\.([\w-]+)/g, 'needs["$1"]');
  const needs = {
    classify: { result: classification, outputs: Object.fromEntries(Object.entries(impact).map(([key, value]) => [key, String(value)])) },
    'verify-main': { result: verification },
    deploy: { result: deployment, outputs: { worker_deployed: worker, migrations_applied: migrations } },
  };
  return Function('needs', 'always', `return (${expression});`)(needs, () => true);
}

test('Runtime publication waits for every required Cloudflare operation and rejects skipped or stale outcomes', () => {
  const runtimeFile = { filename: 'adt-runtime/src/server.ts' };
  for (const files of [
    [{ filename: 'app/page.tsx' }, runtimeFile],
    [{ filename: 'migrations/0022_add_checkpoint_write_task_paths.sql' }, runtimeFile],
    [{ filename: 'app/page.tsx' }, { filename: 'migrations/0022_add_checkpoint_write_task_paths.sql' }, runtimeFile],
  ]) {
    const impact = classifyChanges(files);
    assert.equal(impact.deploy_cloudflare, true);
    const completed = { worker: String(impact.deploy_worker), migrations: String(impact.apply_migrations) };
    assert.equal(runtimePublicationAllowed(impact, completed), true);
    for (const deployment of ['failure', 'cancelled', 'skipped']) assert.equal(runtimePublicationAllowed(impact, { ...completed, deployment }), false);
    for (const verification of ['failure', 'cancelled', 'skipped']) assert.equal(runtimePublicationAllowed(impact, { ...completed, verification }), false);
    // A reusable workflow can report success after freshness skips its actual job.
    assert.equal(runtimePublicationAllowed(impact), false);
    if (impact.deploy_worker) for (const worker of ['', 'false']) assert.equal(runtimePublicationAllowed(impact, { ...completed, worker }), false);
    if (impact.apply_migrations) for (const migrations of ['', 'false']) assert.equal(runtimePublicationAllowed(impact, { ...completed, migrations }), false);
    assert.equal(runtimePublicationAllowed(impact, { ...completed, classification: 'failure' }), false);
  }
});

test('Runtime-only publication remains available when Cloudflare and its shared gate are skipped', () => {
  const impact = classifyChanges([{ filename: 'adt-runtime/src/server.ts' }]);
  assert.equal(impact.deploy_cloudflare, false);
  assert.equal(runtimePublicationAllowed(impact, { verification: 'skipped', deployment: 'skipped' }), true);
  assert.equal(runtimePublicationAllowed({ ...impact, publish_runtime: false }), false);
});

test('migration completion is exposed only after successful migrations and any required Worker deployment', () => {
  const workflow = parse(reusableDeploy), job = workflow.jobs.deploy;
  assert.equal(workflow.on.workflow_call.outputs.migrations_applied.value, '${{ jobs.deploy.outputs.migrations_applied }}');
  assert.equal(job.outputs.migrations_applied, '${{ steps.outcome.outputs.migrations_applied }}');
  const index = (command) => job.steps.findIndex(step => step.run?.includes(command));
  const outcome = job.steps.findIndex(step => step.id === 'outcome');
  assert.ok(outcome > index('wrangler d1 migrations apply'));
  assert.ok(outcome > index('wrangler deploy'));
  assert.equal(job.steps[outcome].if, undefined);
  assert.match(job.steps[outcome].run, /migrations_applied=\$\{\{ inputs\.apply_migrations \}\}/);
  assert.match(job.if, /needs\.freshness\.outputs\.current == 'true'/);
});

test('mixed Cloudflare and Adrian changes share main verification while Adrian-only publication stays independent', () => {
  const mixed = classifyChanges([
    { filename: 'app/page.tsx' },
    { filename: 'third_party/adrian/backend/go.mod' },
  ]);
  assert.equal(mixed.deploy_cloudflare, true);
  assert.equal(mixed.publish_adrian, true);
  assert.match(main, /publish-adrian:[\s\S]*needs: \[resolve-context, classify, verify-main\]/);
  assert.match(main, /publish-adrian:[\s\S]*deploy_cloudflare != 'true' \|\| needs\.verify-main\.result == 'success'/);

  const adrianOnly = classifyChanges([{ filename: 'third_party/adrian/backend/go.mod' }]);
  assert.equal(adrianOnly.publish_adrian, true);
  assert.equal(adrianOnly.deploy_cloudflare, false);
});

test('main lifecycle always calls Adrian with source publication semantics, including manual main reprocessing', () => {
  assert.match(main, /workflow_dispatch:/);
  assert.match(main, /publish-adrian:[\s\S]*publication_mode: source/);
  assert.match(adrianPublish, /publication_mode:[\s\S]*required: true/);
  assert.doesNotMatch(adrianPublish, /github\.event_name/);
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

test('shared Runner release requires an explicitly successful Worker deployment outcome before Runner publication', () => {
  assert.match(reusableDeploy, /runner_release_barrier:[\s\S]*default: false/);
  assert.match(reusableDeploy, /worker_deployed:[\s\S]*value: \$\{\{ jobs\.deploy\.outputs\.worker_deployed \}\}/);
  assert.match(reusableDeploy, /id: outcome[\s\S]*worker_deployed=\$\{\{ inputs\.deploy_worker \}\}/);
  assert.match(main, /runner_release_barrier: \$\{\{ needs\.classify\.outputs\.runner_release_barrier == 'true' \}\}/);
  assert.match(main, /runner_release_barrier != 'true'[\s\S]*needs\.deploy\.result == 'success' && needs\.deploy\.outputs\.worker_deployed == 'true'/);
});

test('all automatic freshness paths call the one shared range/freshness implementation', () => {
  for (const [name, source, operation] of [
    ['Cloudflare', reusableDeploy, 'cloudflare'],
    ['Runtime', runtimePublish, 'runtime'],
    ['Runner', runnerPublish, 'runner'],
    ['Adrian', adrianPublish, 'adrian'],
  ]) {
    assert.match(source, new RegExp(`node scripts/evaluate-deployment-freshness\\.mjs ${operation}`), name);
    assert.doesNotMatch(source, /node --input-type=module <<'NODE' > classification\.txt/, name);
  }
  assert.match(freshnessPolicy, /execFileSync/);
  assert.match(freshnessPolicy, /\['diff', '--name-status', '-M', baseRef, headRef\]/);
  assert.match(freshnessPolicy, /classifyChanges\(parseGitNameStatus\(diff\)\)/);
});

test('component publishers remain reusable exact-commit workflows with component-scoped shared freshness', () => {
  for (const [name, source, operation] of [['Runtime', runtimePublish, 'runtime'], ['Runner', runnerPublish, 'runner']]) {
    assert.match(source, /workflow_call:[\s\S]*commit_sha:[\s\S]*required: true/, name);
    assert.match(source, /workflow_dispatch:/, name);
    assert.doesNotMatch(source, /\n  push:/, name);
    assert.match(source, /if: github\.ref == 'refs\/heads\/main'/, name);
    assert.match(source, /TARGET_SHA: \$\{\{ inputs\.commit_sha \|\| github\.sha \}\}/, name);
    assert.match(source, /test "\$\(git rev-parse HEAD\)" = "\$\{TARGET_SHA\}"/, name);
    assert.match(source, new RegExp(`evaluate-deployment-freshness\\.mjs ${operation}`), name);
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

test('Cloudflare freshness delegates operation-aware supersession to the shared policy and fails closed through it', () => {
  assert.match(reusableDeploy, /node scripts\/evaluate-deployment-freshness\.mjs cloudflare/);
  assert.match(reusableDeploy, /TARGET_DEPLOY_WORKER: \$\{\{ inputs\.deploy_worker \}\}/);
  assert.match(reusableDeploy, /TARGET_APPLY_MIGRATIONS: \$\{\{ inputs\.apply_migrations \}\}/);
  assert.match(reusableDeploy, /TARGET_RUNNER_RELEASE_BARRIER: \$\{\{ inputs\.runner_release_barrier \}\}/);
  assert.match(freshnessPolicy, /interveningImpact\.has_unclassified_changes/);
  assert.match(freshnessPolicy, /interveningImpact\.deploy_worker/);
  assert.match(freshnessPolicy, /interveningImpact\.apply_migrations/);
  assert.match(freshnessPolicy, /interveningImpact\.runner_release_barrier/);
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
  assert.match(main, /Shared Runner release barrier:/);
  assert.match(main, /Worker actually deployed by this lifecycle:/);
  assert.match(main, /Cloudflare operation: skipped — Worker and migration inputs unchanged/);
});


test('application-only repair reconciles blocked Runtime only after successful current Cloudflare deployment', () => {
  const impact = classifyChanges([{ filename: 'package-lock.json' }]);
  assert.equal(impact.publish_runtime, false);
  const completed = { worker: 'true', migrations: 'true' };
  assert.equal(runtimePublicationAllowed(impact, completed), true);
  for (const deployment of ['failure', 'cancelled', 'skipped']) assert.equal(runtimePublicationAllowed(impact, { ...completed, deployment }), false);
  assert.equal(runtimePublicationAllowed(impact), false);
  assert.equal(runtimePublicationAllowed(impact, { ...completed, migrations: '' }), false);
});
test('build dependencies and Worker configuration always exercise the local runtime smoke',()=>{
  const steps=parse(verify).jobs.verify.steps;
  const build=steps.findIndex(step=>step.run==='npm run build:worker');
  const smoke=steps.findIndex(step=>step.run==='npm run test:worker-runtime');
  assert.ok(smoke>build);assert.equal(steps[smoke].if,'inputs.verify_app');
  for(const filename of ['package.json','package-lock.json','wrangler.jsonc','cloudflare-worker.ts','open-next.config.ts','scripts/smoke-test-worker.mjs'])assert.equal(classifyChanges([{filename}]).verify_app,true,filename);
});
