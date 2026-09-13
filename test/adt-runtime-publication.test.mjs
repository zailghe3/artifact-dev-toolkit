import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/publish-adt-runtime.yml', import.meta.url), 'utf8');
const main = readFileSync(new URL('../.github/workflows/main-orchestrator.yml', import.meta.url), 'utf8');
const stack = readFileSync(new URL('../adt-runtime/docker-stack.example.yml', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../adt-runtime/Dockerfile', import.meta.url), 'utf8');

test('trusted Runtime publication is reusable and targets Docker Hub only', () => {
  assert.match(workflow, /workflow_call:[\s\S]*commit_sha:[\s\S]*required: true/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.match(workflow, /image=poulti\/adt-runtime/);
  assert.match(workflow, /"\$image:\$\{TARGET_SHA\}"/);
  assert.match(workflow, /"\$image:latest"/);
  assert.equal((workflow.match(/docker tag adt-runtime:verified/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /ghcr\.io|packages: write|self-hosted|portainer|shepherd/i);
  assert.match(workflow, /docker manifest inspect/);
});

test('Main publishes Runtime only from canonical component impact and immutable target SHA', () => {
  const job = main.slice(main.indexOf('  publish-runtime:'), main.indexOf('  publish-runner:'));
  assert.match(job, /needs\.classify\.outputs\.publish_runtime == 'true'/);
  assert.match(job, /uses: \.\/\.github\/workflows\/publish-adt-runtime\.yml/);
  assert.match(job, /commit_sha: \$\{\{ needs\.resolve-context\.outputs\.target_sha \}\}/);
  assert.match(job, /integration_already_verified: \$\{\{/);
  assert.match(job, /DOCKERHUB_TOKEN: \$\{\{ secrets\.DOCKERHUB_TOKEN \}\}/);
});

test('Runtime publisher verifies exact source before testing or publishing', () => {
  assert.match(workflow, /TARGET_SHA: \$\{\{ inputs\.commit_sha \|\| github\.sha \}\}/);
  assert.match(workflow, /ref: \$\{\{ inputs\.commit_sha \|\| github\.sha \}\}/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$\{TARGET_SHA\}"/);
  assert.match(workflow, /ADT_RUNTIME_REVISION="\$\{TARGET_SHA\}"/);
  assert.doesNotMatch(workflow, /ADT_RUNTIME_REVISION="\$GITHUB_SHA"/);
});

test('publication reuses same-job Runtime build and only skips integration after the trusted main gate', () => {
  const runtimeInstall = workflow.indexOf('Install ADT Runtime dependencies in isolation');
  const runtimeTest = workflow.indexOf('Test exact merged Runtime source in isolation');
  const rootInstall = workflow.indexOf('Install root integration dependencies');
  const integrationTest = workflow.indexOf('Test control-plane and ADT Runtime integration using tested Runtime build');
  const imageBuild = workflow.indexOf('Build and smoke-test exact image');
  const login = workflow.indexOf('Authenticate to Docker Hub');
  const push = workflow.indexOf('Publish the same verified image under immutable and moving tags');
  assert.ok(runtimeInstall >= 0 && runtimeInstall < runtimeTest);
  assert.ok(runtimeTest < rootInstall && rootInstall < integrationTest);
  assert.ok(integrationTest < imageBuild && imageBuild < login && login < push);
  assert.match(workflow.slice(runtimeInstall, runtimeTest), /working-directory: adt-runtime[\s\S]*run: npm ci/);
  assert.match(workflow.slice(runtimeTest, rootInstall), /run: npm test/);
  assert.doesNotMatch(workflow.slice(runtimeTest, rootInstall), /npm run typecheck/);
  assert.match(workflow.slice(rootInstall, integrationTest), /if: inputs\.integration_already_verified != true/);
  assert.match(workflow.slice(integrationTest, imageBuild), /if: inputs\.integration_already_verified != true[\s\S]*node --test test\/integration\/workflow-runtime-integration\.test\.mjs/);
  assert.match(workflow, /integration_already_verified:[\s\S]*default: false/);
});

test('operator service remains stateless, bounded, external-secret based, and non-root', () => {
  assert.match(stack, /image: poulti\/adt-runtime:latest/);
  assert.match(stack, /external: true/);
  assert.match(stack, /limits:/);
  assert.doesNotMatch(stack, /volumes:|docker\.sock|provider.*key/i);
  assert.match(dockerfile, /USER node/);
  assert.doesNotMatch(dockerfile, /VOLUME|ghcr\.io/);
});

test('image revision is build-owned and Runtime key identity needs no separately provisioned secret', () => {
  assert.match(dockerfile, /printf '%s' "\$ADT_RUNTIME_REVISION" > \/runtime\/REVISION/);
  assert.doesNotMatch(dockerfile, /ENV ADT_RUNTIME_REVISION/);
  assert.doesNotMatch(stack, /ADT_RUNTIME_REVISION|ADT_RUNTIME_KEY_ID|adt_runtime_key_id/);
  assert.equal((stack.match(/external: true/g) ?? []).length, 3);
  assert.match(workflow, /smoke-image\.sh adt-runtime:verified "\$\{TARGET_SHA\}"/);
});
