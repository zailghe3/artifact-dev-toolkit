import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { RemoteOpenAIAgentsRuntime } from '../lib/adt-runtime-client.ts';
import { diagnoseRuntimeManagement, runtimeControl } from '../lib/runtime-service-client.ts';

const scope = { repositoryId: 46, installationId: 52, owner: 'owner', repository: 'repo', branch: 'main', root: 'root' };
const authSecret = 'local-management-test-secret'.repeat(2);

test('Worker parses legacy management envelopes and rejects invalid or incompatible HTTP responses', async t => {
  const logs = t.mock.method(console, 'info', () => {});
  let reply;
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => response.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body)));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}`, authSecret };
  const list = { operation: 'runs.list', repositoryId: scope.repositoryId, limit: 1 };
  reply = { status: 200, body: { protocolVersion: 'adt-runtime-v1', ok: true, result: [] } };
  assert.deepEqual(await runtimeControl(config, list), []);
  reply = { status: 400, body: { protocolVersion: 'adt-runtime-v1', ok: false, code: 'invalid_request' } };
  const release16 = await diagnoseRuntimeManagement(config, scope);
  assert.equal(release16.management.result, 'request_rejected');
  assert.equal(release16.management.dispatched, null);
  assert.equal(release16.dependencies.workflow.status, 'not_verified');
  reply = { status: 401, body: { protocolVersion: 'adt-runtime-v1', ok: false, error: { code: 'runtime_authentication_failed' } } };
  assert.equal((await diagnoseRuntimeManagement(config, scope)).management.result, 'authentication_failed');
  reply = { status: 409, body: { protocolVersion: 'adt-runtime-v2', ok: false, code: 'protocol_incompatible' } };
  assert.equal((await diagnoseRuntimeManagement(config, scope)).management.result, 'protocol_incompatible');
  reply = { status: 403, body: { protocolVersion: 'adt-runtime-v1', ok: false, code: 'permission_denied' } };
  await assert.rejects(runtimeControl(config, list), { message: 'permission_denied' });
  reply = { status: 503, body: { protocolVersion: 'adt-runtime-v1', ok: false, code: 'private_token_marker' } };
  const unsafe = await diagnoseRuntimeManagement(config, scope);
  assert.equal(unsafe.management.result, 'malformed_response');
  assert.doesNotMatch(JSON.stringify(unsafe), /private_token_marker|local-management-test-secret/);
  assert.doesNotMatch(JSON.stringify(logs.mock.calls.map(call => call.arguments)), /private_token_marker|local-management-test-secret/);
  reply = { status: 200, body: { protocolVersion: 'adt-runtime-v1', ok: true, result: null } };
  await assert.rejects(runtimeControl(config, list), error => error.observation.result === 'malformed_response');
});

test('a non-Runtime readiness response gives no authentication or protocol evidence', async () => {
  const runtime = new RemoteOpenAIAgentsRuntime({ baseUrl: 'https://runtime.example', authSecret },
    async () => new Response('<html>private upstream prompt</html>', { status: 503 }));
  const result = await runtime.diagnose();
  assert.equal(result.reachable, true);
  assert.equal(result.httpStatus, 503);
  assert.equal(result.authenticationAccepted, null);
  assert.equal(result.protocolCompatible, false);
  assert.equal(result.readinessAccepted, false);
  assert.doesNotMatch(JSON.stringify(result), /private upstream prompt/);
});

test('a transport failure leaves upstream authentication and storage unverified', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.close(resolve));
  const result = await diagnoseRuntimeManagement({ baseUrl, authSecret }, scope);
  assert.equal(result.management.result, 'unreachable');
  assert.equal(result.management.authenticated, null);
  assert.equal(result.management.httpStatus, undefined);
  assert.equal(result.dependencies.broker.status, 'not_verified');
});
