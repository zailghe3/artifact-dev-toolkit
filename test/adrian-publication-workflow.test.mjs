import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const source = readFileSync('.github/workflows/publish-adrian.yml', 'utf8');
const workflow = parse(source);
const triggers = workflow.on;

test('Adrian publisher is reusable and directly dispatchable without a push trigger', () => {
  assert.ok(triggers.workflow_call);
  assert.ok(triggers.workflow_dispatch !== undefined);
  assert.equal(triggers.push, undefined);
  assert.equal(triggers.workflow_call.inputs.publication_mode.required, true);
  assert.equal(triggers.workflow_dispatch?.inputs, undefined);
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
});

test('publisher derives tag mode from the explicit call contract rather than caller event type', () => {
  assert.match(source, /ADRIAN_PUBLICATION_CALL_MODE: \$\{\{ inputs\.publication_mode \}\}/);
  assert.match(source, /node scripts\/adrian-publication-plan\.mjs/);
  assert.doesNotMatch(source, /github\.event_name|EVENT_NAME/);
  assert.match(source, /PUBLICATION_MODE: \$\{\{ steps\.plan\.outputs\.mode \}\}/);
});

test('Adrian validation precedes Docker Hub authentication and only the intended registry is used', () => {
  const login = source.indexOf('Authenticate to Docker Hub');
  for (const required of ['Verify exact publication commit and provenance', 'Test vendored backend', 'Build image once', 'Smoke-test built image']) assert.ok(source.indexOf(required) < login, required);
  assert.match(source, /poulti\/adrian-backend/);
  assert.doesNotMatch(source, /ghcr\.io|quay\.io|OPENAI|PORTAINER/);
});

test('immutable source and rebuild tags are protected while latest may move', () => {
  assert.match(source, /IMMUTABLE_TAG: \$\{\{ steps\.plan\.outputs\.immutable_tag \}\}/);
  assert.match(source, /UPSTREAM_TAG: \$\{\{ steps\.plan\.outputs\.upstream_tag \}\}/);
  assert.match(source, /Refusing to overwrite/);
  assert.match(source, /leaving it unchanged/);
  assert.match(source, /\$\{IMAGE\}:latest/);
});
