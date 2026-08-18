import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const verify = read('.github/workflows/reusable-verify.yml');
const publish = read('.github/workflows/publish-codex-runner.yml');
const smoke = read('codex-runner/scripts/smoke-image.sh');
const invocation = /codex-runner\/scripts\/smoke-image\.sh adt-codex-runner:(?:pr|validated)/g;

test('publication prepares both dependency graphs before testing merged Runner source', () => {
  const rootInstall = publish.indexOf('Install root dependencies required by cross-boundary Runner integration tests');
  const runnerTest = publish.indexOf('Test exact merged source');
  const buildAndSmoke = publish.indexOf('Build and smoke test');
  const login = publish.indexOf('Authenticate to Docker Hub');

  assert.match(publish, /Install canonical npm[\s\S]*packageManager/);
  assert.ok(rootInstall >= 0 && rootInstall < runnerTest);
  assert.match(publish.slice(rootInstall, runnerTest), /run:\s*npm ci/);
  assert.match(
    publish.slice(runnerTest, buildAndSmoke),
    /working-directory:\s*codex-runner[\s\S]*run:\s*npm ci && npm test && npm run typecheck/,
  );
  assert.match(publish, /cache-dependency-path:\s*\|[\s\S]*package-lock\.json[\s\S]*codex-runner\/package-lock\.json/);
  assert.ok(runnerTest < buildAndSmoke && buildAndSmoke < login);
});

test('trusted publication exclusively owns the Runner image smoke', () => {
  assert.equal(verify.match(invocation)?.length ?? 0, 0);
  assert.doesNotMatch(verify, /docker build/);
  assert.equal(publish.match(invocation)?.length, 1);
  assert.doesNotMatch(verify, /\/v1\/(?:capabilities|auth\/status)/);
  assert.doesNotMatch(publish, /\/v1\/(?:capabilities|auth\/status)/);
});

test('publish stays fail-closed after the shared smoke gate', () => {
  const smokeGate = publish.indexOf('codex-runner/scripts/smoke-image.sh');
  const login = publish.indexOf('docker login');
  const collision = publish.indexOf('docker manifest inspect');
  const immutablePush = publish.indexOf('docker push "$image:$GITHUB_SHA"');
  const latestPush = publish.indexOf('docker push "$image:latest"');
  assert.ok(smokeGate >= 0 && smokeGate < login);
  assert.ok(login < collision && collision < immutablePush && immutablePush < latestPush);
  assert.match(publish, /Immutable SHA tag already exists; refusing overwrite/);
  assert.doesNotMatch(publish, /CODEX_HOME/);
});

test('shared smoke waits independently for HTTP and Codex readiness', () => {
  assert.match(smoke, /set -euo pipefail/);
  assert.match(smoke, /release_file="\$script_dir\/\.\.\/release\.json"/);
  assert.match(smoke, /keys == \["codexVersion","protocolVersion","runnerRevision"\]/);
  assert.doesNotMatch(smoke, /expected_(?:codex_version|runner_revision)=/);
  assert.match(smoke, /node dist\/validate-device-auth-schema\.js codex/);
  assert.match(smoke, /CODEX_RUNNER_SHARED_SECRET_FILE=\/run\/secrets\/runner/);
  assert.doesNotMatch(smoke, /CODEX_HOME/);
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
