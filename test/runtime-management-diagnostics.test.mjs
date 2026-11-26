import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { RemoteOpenAIAgentsRuntime } from '../lib/adt-runtime-client.ts';
import { diagnoseRuntimeManagement, runtimeControl, WORKFLOW_HISTORY_LIMIT } from '../lib/runtime-service-client.ts';

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
  for (const result of [null, [null], [{}]]) {
    reply = { status: 200, body: { protocolVersion: 'adt-runtime-v1', ok: true, result } };
    await assert.rejects(runtimeControl(config, list), error => error.observation.result === 'malformed_response');
  }
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

test('the diagnostic uses the page history limit and ordinary response validation even if Runtime reports its probe healthy', async t => {
  const operations = [];
  const newest = { id: 'newest', workflowId: 'fixture', status: 'succeeded', createdAt: '2026-01-02T00:00:00Z' };
  let rows = [newest, { id: 'older', privateInput: 'private older Workflow input' }];
  let legacy = false;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const command = JSON.parse(Buffer.concat(chunks).toString());
    operations.push(command);
    const protocolVersion = 'adt-runtime-v1';
    if (legacy && command.operation === 'runs.diagnose') {
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({
        protocolVersion, ok: false, code: 'invalid_request',
      }));
      return;
    }
    const requestId = createHash('sha256').update(request.headers['x-adt-nonce']).digest('base64url').slice(0, 32);
    const available = { status: 'available' };
    const result = command.operation === 'runs.list' ? rows.slice(0, command.limit)
      : { postgres: available, checkpoints: available, workflow: available, broker: available };
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      protocolVersion, ok: true, result, ...(legacy ? {} : { management: {
        requestId, stage: 'complete', result: 'ok', authenticated: true, protocolCompatible: true,
        noncePersisted: true, accepted: true, dispatched: true,
      } }),
    }));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}`, authSecret };
  const list = { operation: 'runs.list', repositoryId: scope.repositoryId, limit: WORKFLOW_HISTORY_LIMIT };
  assert.deepEqual(await runtimeControl(config, { ...list, limit: 1 }), [newest]);
  await assert.rejects(runtimeControl(config, list), { code: 'runtime_response_invalid' });
  operations.length = 0;
  const invalid = await diagnoseRuntimeManagement(config, scope);
  assert.equal(invalid.management.result, 'ok');
  assert.deepEqual(operations.find(command => command.operation === 'runs.list'), list);
  assert.equal(invalid.workflowHistory.result, 'malformed_response');
  assert.equal(invalid.workflowHistory.httpStatus, 200);
  assert.equal(invalid.dependencies.workflow.status, 'unavailable');
  assert.equal(invalid.dependencies.workflow.result, undefined);
  assert.equal(invalid.dependencies.postgres.status, 'available');
  assert.doesNotMatch(JSON.stringify(invalid), /private older Workflow input|"newest"|"older"/);

  rows = [];
  assert.equal((await diagnoseRuntimeManagement(config, scope)).dependencies.workflow.status, 'available');
  legacy = true;
  const release16 = await diagnoseRuntimeManagement(config, scope);
  assert.equal(release16.management.result, 'request_rejected');
  assert.equal(release16.workflowHistory.result, 'ok');
  assert.deepEqual(await runtimeControl(config, list), []);
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
