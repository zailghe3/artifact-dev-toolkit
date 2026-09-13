import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const verify = read('.github/workflows/reusable-verify.yml');
const main = read('.github/workflows/main-orchestrator.yml');
const publish = read('.github/workflows/publish-codex-runner.yml');
const smoke = read('codex-runner/scripts/smoke-image.sh');
const invocation = /codex-runner\/scripts\/smoke-image\.sh adt-codex-runner:(?:pr|validated)/g;

test('trusted Runner publication is reusable, exact-commit, and avoids duplicate TypeScript compilation', () => {
  assert.match(publish, /workflow_call:[\s\S]*commit_sha:[\s\S]*required: true/);
  assert.match(publish, /workflow_dispatch:/);
  assert.doesNotMatch(publish, /\n  push:/);
  assert.match(publish, /TARGET_SHA: \$\{\{ inputs\.commit_sha \|\| github\.sha \}\}/);
  assert.match(publish, /ref: \$\{\{ inputs\.commit_sha \|\| github\.sha \}\}/);
  assert.match(publish, /test "\$\(git rev-parse HEAD\)" = "\$\{TARGET_SHA\}"/);
  assert.doesNotMatch(publish, /Install root dependencies required by cross-boundary Runner integration tests/);
  assert.match(publish, /working-directory: codex-runner[\s\S]*run: npm ci && npm test/);
  assert.doesNotMatch(publish, /npm test && npm run typecheck/);
});

test('Main publishes Runner only from canonical component impact and passes the immutable merge SHA', () => {
  const job = main.slice(main.indexOf('  publish-runner:'), main.indexOf('  summary:'));
  assert.match(job, /needs\.classify\.outputs\.publish_runner == 'true'/);
  assert.match(job, /uses: \.\/\.github\/workflows\/publish-codex-runner\.yml/);
  assert.match(job, /commit_sha: \$\{\{ needs\.resolve-context\.outputs\.target_sha \}\}/);
  assert.match(job, /DOCKERHUB_TOKEN: \$\{\{ secrets\.DOCKERHUB_TOKEN \}\}/);
  assert.match(job, /deploy_worker != 'true' \|\| needs\.deploy\.result == 'success'/);
});

test('pull-request verification gates Runner image and proxy smokes independently', () => {
  assert.equal(verify.match(invocation)?.length, 1);
  assert.match(verify, /name: Build Codex Runner image\s+if: inputs\.smoke_runner_image[\s\S]*docker build[^\n]*adt-codex-runner:pr-verified codex-runner/);
  assert.match(verify, /name: Smoke-test Codex Runner image\s+if: inputs\.smoke_runner_image/);
  assert.match(verify, /name: Smoke-test Codex Runner proxy policy\s+if: inputs\.smoke_runner_proxy_policy/);
  assert.doesNotMatch(verify, /name: Smoke-test Codex Runner proxy policy\s+if: inputs\.smoke_runner_image/);
  assert.doesNotMatch(verify, /\/v1\/(?:capabilities|auth\/status)/);
});

test('trusted publication builds and smokes the Runner image once before Docker Hub mutation without proxy-policy work', () => {
  assert.equal(publish.match(invocation)?.length, 1);
  const testSource = publish.indexOf('Test exact merged source');
  const build = publish.indexOf('Build Codex Runner image');
  const imageSmoke = publish.indexOf('codex-runner/scripts/smoke-image.sh adt-codex-runner:validated');
  const login = publish.indexOf('docker login');
  const collision = publish.indexOf('docker manifest inspect');
  const immutablePush = publish.indexOf('docker push "$image:${TARGET_SHA}"');
  const latestPush = publish.indexOf('docker push "$image:latest"');
  assert.ok(testSource >= 0 && testSource < build && build < imageSmoke && imageSmoke < login);
  assert.ok(login < collision && collision < immutablePush && immutablePush < latestPush);
  assert.doesNotMatch(publish, /smoke-proxy-policy\.sh/);
  assert.match(publish, /Immutable SHA tag already exists; refusing overwrite/);
  assert.doesNotMatch(publish, /CODEX_HOME/);
});

test('Runner publication uses the requested exact SHA for image identity and tags', () => {
  assert.match(publish, /CODEX_RUNNER_VERSION="\$\{TARGET_SHA\}"/);
  assert.match(publish, /"\$image:\$\{TARGET_SHA\}"/);
  assert.doesNotMatch(publish, /"\$image:\$GITHUB_SHA"/);
});

test('shared smoke waits independently for HTTP and Codex readiness', () => {
  assert.match(smoke, /set -euo pipefail/);
  assert.match(smoke, /release_file="\$script_dir\/\.\.\/release\.json"/);
  assert.match(smoke, /keys == \["codexVersion","protocolVersion","runnerRevision"\]/);
  assert.doesNotMatch(smoke, /expected_(?:codex_version|runner_revision)=/);
  assert.match(smoke, /node dist\/validate-device-auth-schema\.js codex/);
  assert.match(smoke, /CODEX_RUNNER_SHARED_SECRET_FILE=\/run\/secrets\/runner/);
  assert.match(smoke, /--read-only/);
  assert.match(smoke, /--cap-drop ALL/);
  assert.match(smoke, /codex_home_volume/);
  assert.match(smoke, /test -s "\$CODEX_HOME\/installation_id"/);
  assert.match(smoke, /http_healthy=false[\s\S]*for _attempt in \{1\.\.20\}[\s\S]*http_healthy=true/);
  assert.match(smoke, /codex_ready=false[\s\S]*for _attempt in \{1\.\.20\}[\s\S]*\/v1\/capabilities[\s\S]*codex_ready=true/);
  assert.match(smoke, /\.protocolVersion == \$release\.protocolVersion/);
  assert.match(smoke, /\.runnerRevision == \$release\.runnerRevision/);
  assert.match(smoke, /\.codexVersion == \$release\.codexVersion/);
  assert.match(smoke, /\.codexAvailable == true/);
  assert.match(smoke, /\.deviceAuth == true/);
  assert.match(smoke, /\.jobExecution == true/);
  assert.match(smoke, /\/v1\/auth\/status[\s\S]*\.connected == false and \.runtime == "app-server-ready"/);
  assert.match(smoke, /\/v1\/environments[\s\S]*\.environments == \[\]/);
  assert.match(smoke, /test -w \/data\/runner/);
});

test('shared smoke never initiates authentication', () => {
  for (const source of [smoke, verify, publish]) {
    assert.doesNotMatch(source, /\/v1\/auth\/device\/start|chatgptDeviceCode|device-code|openai\.com/);
  }
});

test('shared smoke proves signed executor-role App Server readiness without weakening isolation', () => {
  assert.match(smoke, /CODEX_RUNNER_ROLE=executor/);
  assert.match(smoke, /CODEX_RUNNER_EXECUTOR_VERIFYING_PUBLIC_KEY_FILE/);
  assert.match(smoke, /openssl genpkey -algorithm ED25519/);
  assert.match(smoke, /adt-executor-v1\\nGET\\n\/internal\/v1\/status/);
  assert.match(smoke, /openssl pkeyutl -sign -rawin -in "\$canonical_request" -inkey "\$signing_key"/);
  assert.doesNotMatch(smoke, /printf '%s' "\$canonical" \| openssl pkeyutl/);
  assert.match(smoke, /\.healthy == true[\s\S]*\.boundary == "container"/);
  assert.match(smoke, /HTTP_PROXY=http:\/\/127\.0\.0\.1:9/);
  assert.doesNotMatch(smoke, /--privileged|--cap-add|SYS_ADMIN|--network host|docker\.sock|seccomp=unconfined|apparmor=unconfined/);
  const executorRun = smoke.slice(smoke.indexOf('docker run -d --name "$container_name" --read-only', smoke.indexOf('CODEX_RUNNER_ROLE=executor') - 500));
  assert.doesNotMatch(executorRun, /CODEX_RUNNER_SHARED_SECRET|signing-key\.pem:|\/data\/runner|runner_state_volume/);
});
