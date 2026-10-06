import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('adrian/scripts/smoke-image.sh', 'utf8');

test('Adrian image smoke supplies a reachable isolated classifier and exercises readiness', () => {
  assert.match(source, /docker network create/);
  assert.match(source, /python:3\.13-alpine python -m http\.server/);
  assert.match(source, /ADRIAN_LLM_URL=http:\/\/\$\{classifier\}:8081\/v1/);
  assert.match(source, /docker exec "\$name" \/adrian healthcheck/);
  assert.doesNotMatch(source, /127\.0\.0\.1:9|\/healthz/);
});

test('Adrian image smoke cleans backend, classifier, and network on every exit', () => {
  assert.match(source, /trap cleanup EXIT/);
  assert.match(source, /docker rm -f "\$name" "\$classifier"/);
  assert.match(source, /docker network rm "\$network"/);
});
