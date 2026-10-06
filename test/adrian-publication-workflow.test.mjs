import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = readFileSync('.github/workflows/publish-adrian.yml', 'utf8');
test('Adrian publisher is reusable and manual, trusted-main only, and never directly push-triggered', () => {
  assert.match(source, /workflow_call:/);
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /^\s+push:/m);
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
});
test('Adrian validation precedes Docker Hub authentication and only the intended registry is used', () => {
  const login = source.indexOf('Authenticate to Docker Hub');
  for (const required of ['Verify exact publication commit and provenance', 'Test vendored backend', 'Build image once', 'Smoke-test built image']) assert.ok(source.indexOf(required) < login, required);
  assert.match(source, /poulti\/adrian-backend/);
  assert.doesNotMatch(source, /ghcr\.io|quay\.io|OPENAI|PORTAINER/);
});
test('immutable source and rebuild tags are protected while latest may move', () => {
  assert.match(source, /upstream-\$\{upstream_sha\}/);
  assert.match(source, /rebuild-\$\{RUN_ID\}-\$\{RUN_ATTEMPT\}/);
  assert.match(source, /Refusing to overwrite/);
  assert.match(source, /leaving it unchanged/);
  assert.match(source, /\$\{IMAGE\}:latest/);
});
