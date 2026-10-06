import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAdrianPublicationPlan } from '../scripts/adrian-publication-plan.mjs';

const targetSha = 'a'.repeat(40);
const upstreamSha = 'b'.repeat(40);

test('reusable publication always receives normal source tag semantics', () => {
  assert.deepEqual(resolveAdrianPublicationPlan({
    callMode: 'source', targetSha, upstreamSha, runId: '100', runAttempt: '2',
  }), {
    mode: 'source', immutableTag: targetSha, upstreamTag: `upstream-${upstreamSha}`,
  });
});

test('direct dispatch receives only an immutable rebuild identity', () => {
  assert.deepEqual(resolveAdrianPublicationPlan({
    callMode: '', targetSha, upstreamSha, runId: '100', runAttempt: '2',
  }), {
    mode: 'rebuild', immutableTag: 'rebuild-100-2', upstreamTag: '',
  });
});

test('unknown call modes and malformed immutable identities fail closed', () => {
  assert.throws(() => resolveAdrianPublicationPlan({ callMode: 'rebuild', targetSha, upstreamSha, runId: '100', runAttempt: '2' }), /Unsupported/);
  assert.throws(() => resolveAdrianPublicationPlan({ callMode: '', targetSha, upstreamSha, runId: 'bad', runAttempt: '2' }), /numeric/);
  assert.throws(() => resolveAdrianPublicationPlan({ callMode: 'source', targetSha: 'main', upstreamSha, runId: '100', runAttempt: '2' }), /full lowercase/);
});
