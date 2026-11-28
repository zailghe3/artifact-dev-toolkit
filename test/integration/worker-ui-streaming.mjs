import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createFixture } from '../fixtures/worker-ui-fixture.mjs';

const runtime = Promise.withResolvers();
const revision = Promise.withResolvers();
const scriptPath = process.argv[2];
const fixture = await createFixture(scriptPath, { runtimeGate: runtime.promise, revisionGate: revision.promise, runnerFails: true });
const request = (path, session) => fetch(fixture.origin + path, {
  headers: { ...(session ? { cookie: `__Host-adt_session=${session}` } : {}), 'accept-encoding': 'gzip, br' },
  redirect: 'manual',
  signal: AbortSignal.timeout(20_000),
});

try {
  for (const [session, destination] of [[undefined, '/sign-in'], [fixture.deniedSession, '/access-denied']]) {
    const response = await request('/diagnostics', session);
    const body = await response.text();
    assert.ok(response.headers.get('location')?.startsWith(destination) || body.includes(destination), 'Protected route must redirect');
    assert.doesNotMatch(body, /Runner operational readiness|Artifact repository revision|fixture-user/);
  }
  assert.equal(fixture.calls.length, 0, 'Authorization must precede observations');

  const start = performance.now();
  const response = await request('/diagnostics', fixture.session);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  const readThrough = async marker => {
    while (!html.includes(marker)) {
      const { value, done } = await reader.read().catch(error => {
        throw new Error(`Worker stream stalled while waiting for ${marker} after ${html.length} characters`, { cause: error });
      });
      assert.equal(done, false, `Stream ended before ${marker}`);
      html += decoder.decode(value, { stream: true });
    }
    return Math.round(performance.now() - start);
  };

  const shellMs = await readThrough('Diagnostics &amp; maintenance');
  await readThrough('Overall health');
  assert.match(html, /Waiting for required observations/);
  const runnerMs = await readThrough('Runner operational readiness');
  assert.match(html, /Needs attention/);
  assert.doesNotMatch(html, />Infrastructure readiness</);
  const authMs = await readThrough('>Repository access<');
  // The authorization observation can reach the browser while branch revision is waiting.
  assert.doesNotMatch(html, />Catalogue health</);
  revision.resolve();
  const catalogueMs = await readThrough('Catalogue health');
  assert.ok(fixture.calls.some(call => call.pathname === '/v1/readiness'), 'Runtime started while the repository and Runner checks were in progress');
  await delay(600);
  runtime.resolve();
  const runtimeMs = await readThrough('Infrastructure readiness');
  while (!(await reader.read()).done) { /* Drain the response before inspecting observations. */ }

  assert.equal(fixture.calls.filter(call => call.pathname.endsWith('/access_tokens')).length, 2);
  assert.equal(fixture.calls.filter(call => call.pathname === '/v1/readiness').length, 1);
  assert.equal(fixture.calls.filter(call => call.runnerMethod === 'capabilities').length, 1);
  assert.equal(fixture.calls.filter(call => call.operation === 'runs.diagnose' || call.runnerMethod === 'jobs').length, 0);
  assert.ok(fixture.calls.some(call => call.pathname.endsWith('/git/ref/heads/main')));
  assert.doesNotMatch(html, /mock-installation-token|mock-client-credential|BEGIN PRIVATE KEY/);

  const callsBeforeRejections = fixture.calls.length;
  const runnerOperations = '/api/workflow-connections/codex-runner';
  const post = (path, session, origin, body) => fetch(fixture.origin + path, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(session ? { cookie: `__Host-adt_session=${session}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal((await request(`${runnerOperations}/control`)).status, 401);
  assert.equal((await request(`${runnerOperations}/control`, fixture.deniedSession)).status, 403);
  assert.equal((await post(`${runnerOperations}/control`, undefined, fixture.origin, { action: 'resume' })).status, 401);
  assert.equal((await post(`${runnerOperations}/control`, fixture.deniedSession, fixture.origin, { action: 'resume' })).status, 403);
  const crossOrigin = await post(`${runnerOperations}/control`, fixture.session, 'https://other.example.test', { action: 'emergency-stop' });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).code, 'invalid_origin');
  assert.equal((await post(`${runnerOperations}/control`, fixture.session, fixture.origin, { action: 'stop' })).status, 400);
  assert.equal((await post(`${runnerOperations}/test`, fixture.session, 'https://other.example.test', {})).status, 403);
  assert.equal((await post('/api/workflow-connections/adt-runtime/execution-path', undefined, fixture.origin, {})).status, 401);
  assert.equal((await request('/api/diagnostics/repository/validation', fixture.deniedSession)).status, 403);
  assert.ok(fixture.calls.slice(callsBeforeRejections).every(call => call.hostname !== 'runtime.example.test'), 'Rejected operations must not reach Runtime or Runner');

  const signOut = await fetch(fixture.origin + '/sign-out', {
    method: 'POST', headers: { origin: fixture.origin, cookie: `__Host-adt_session=${fixture.session}` }, redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(signOut.status, 303);
  assert.match(signOut.headers.get('set-cookie') ?? '', /__Host-adt_session=;.*Secure/i);
  assert.equal(new URL(signOut.headers.get('location'), fixture.origin).pathname, '/');
  const revoked = await request('/diagnostics', fixture.session);
  const revokedBody = await revoked.text();
  assert.ok(revoked.headers.get('location')?.startsWith('/sign-in') || revokedBody.includes('/sign-in'));
  assert.doesNotMatch(revokedBody, /Runner operational readiness|fixture-user/);
  console.log(`Worker UI stream passed. Shell ${shellMs} ms, Runner ${runnerMs} ms, authorization ${authMs} ms, catalogue ${catalogueMs} ms, Runtime ${runtimeMs} ms.`);
} finally {
  runtime.resolve();
  revision.resolve();
  await fixture.worker.dispose();
}
