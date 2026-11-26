import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { installTsxHook } from './render-tsx.mjs';

const require = installTsxHook();
const Module = require('node:module');
const { renderToReadableStream } = require('react-dom/server');
async function renderPage(page) {
  const stream = await renderToReadableStream(await page());
  await stream.allReady;
  return new Response(stream).text();
}
const app = 'https://adt.example';
const access = { repositoryId: 42 };

let allowed = false;
let authorizationError;
let history = { status: 'unavailable' };
let scopedRequests = [];
let runtimeEnvironment;
let realWorkflowServices;
const runtimeClient = {
  capabilities: async () => ({ protocolVersion: 1, runnerVersion: 'a'.repeat(40), releaseMetadata: 'legacy',
    codexAvailable: false, deviceAuth: false, jobExecution: true }),
  authStatus: async () => ({ connected: true, authMode: 'chatgpt' }),
  authEnvironmentDiagnostics: async () => ({ codexAppServerReady: false, appServerStartup: { category: 'initialize_timeout' } }),
};
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === '@opennextjs/cloudflare') return { getCloudflareContext: async () => ({ env: runtimeEnvironment }) };
  if (name === '@/lib/auth') return {
    requireApiRepositoryAccess: async () => allowed ? { access } : Response.json({}, { status: 401 }),
    requireRepositoryAccess: async () => {
      if (authorizationError) throw authorizationError;
      return { access };
    },
  };
  if (name === '@/lib/workflow-services') return {
    readWorkflowRunHistory: async (repositoryId, limit) => { scopedRequests.push([repositoryId, limit]); return history; },
    diagnoseADTRuntimeExecutionPath: async scope => { scopedRequests.push(scope); return { schema: 'adt.runtime-management.v1' }; },
    getRuntimeCodexRunnerClient: async repositoryId => { scopedRequests.push(repositoryId); return runtimeClient; },
    getWorkflowRunStorage: repositoryId => realWorkflowServices.getWorkflowRunStorage(repositoryId),
  };
  return originalLoad.call(this, name, parent, isMain);
};
let pages, pathDiagnostic, runnerStatus, runnerDiagnostics, workflowRuns;
try {
  realWorkflowServices = require('../lib/workflow-services.ts');
  pages = ['page', 'runs/page'].map(path => require(`../app/(application)/workflows/${path}.tsx`).default);
  pathDiagnostic = require('../app/api/workflow-connections/adt-runtime/execution-path/route.ts').POST;
  runnerStatus = require('../app/api/workflow-connections/codex-runner/status/route.ts').GET;
  runnerDiagnostics = require('../app/api/workflow-connections/codex-runner/diagnostics/route.ts').GET;
  workflowRuns = require('../app/api/workflow-runs/route.ts').GET;
} finally {
  Module._load = originalLoad;
}

test('Workflow pages render the retryable outage state and show an empty history only after successful reads', async () => {
  for (const [index, page] of pages.entries()) {
    history = { status: 'unavailable' };
    const html = await renderPage(page);
    assert.match(html, /Workflow service unavailable/);
    assert.match(html, /Retry loading history/);
    assert.match(html, new RegExp(`action="/workflows${index === 0 ? '' : '/runs'}"`));
    assert.doesNotMatch(html, /no (?:active|workflow) runs/i);
    history = { status: 'available', runs: [] };
    const empty = await renderPage(page);
    assert.match(empty, /no workflow runs yet/i);
    assert.doesNotMatch(empty, /Workflow service unavailable/);
  }
  assert.deepEqual(scopedRequests, [[42, 10], [42, 10], [42, 50], [42, 50]]);
  const denied = new Error('repository access denied');
  authorizationError = denied;
  try { await assert.rejects(pages[0](), denied); }
  finally { authorizationError = undefined; }
});

test('Workflow API and page loader keep Runtime service failures separate from repository denial', async t => {
  const { signedHeaders } = require('../lib/adt-runtime-client.ts');
  const { runtimeControl } = require('../lib/runtime-service-client.ts');
  const authSecret = 'workflow-route-test-secret'.repeat(2);
  const path = '/v1/management/control';
  const protocolVersion = 'adt-runtime-v1';
  let reply;
  let lastRequest;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const nonce = request.headers['x-adt-nonce'];
    const signed = await signedHeaders(authSecret, 'POST', path, body, nonce, request.headers['x-adt-timestamp']);
    const requestId = createHash('sha256').update(nonce).digest('base64url').slice(0, 32);
    lastRequest = { command: JSON.parse(body), requestId, validSignature: signed['x-adt-signature'] === request.headers['x-adt-signature'] };
    const { status, code, stage, result } = reply;
    const dispatched = status === 403;
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({
      protocolVersion, ok: false, code,
      management: { requestId, stage, result, authenticated: status !== 401, protocolCompatible: status === 401 ? null : dispatched,
        noncePersisted: dispatched ? true : null, accepted: dispatched, dispatched },
      privateDebug: 'private response content',
    }));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  runtimeEnvironment = { ADT_RUNTIME_BASE_URL: baseUrl, ADT_RUNTIME_AUTH_SECRET: authSecret };
  allowed = true;
  try {
    const request = new Request(`${app}/api/workflow-runs?limit=50`);
    const command = { operation: 'runs.list', repositoryId: 42, limit: 50 };
    for (reply of [
      { status: 401, code: 'runtime_authentication_failed', stage: 'authentication', result: 'authentication_failed' },
      { status: 409, code: 'protocol_incompatible', stage: 'protocol', result: 'protocol_incompatible' },
      { status: 403, code: 'permission_denied', stage: 'dispatch', result: 'operation_rejected' },
    ]) {
      await assert.rejects(runtimeControl({ baseUrl, authSecret }, command), error =>
        error.code === reply.code && error.observation.httpStatus === reply.status &&
        error.observation.result === reply.result && error.observation.requestId === lastRequest.requestId);
      const response = await workflowRuns(request);
      const body = await response.json();
      assert.equal(response.status, reply.status === 403 ? 403 : 503);
      assert.equal(body.code, reply.code);
      assert.doesNotMatch(JSON.stringify(body), /private response content|requestId|workflow-route-test-secret/);
      assert.deepEqual(lastRequest.command, command);
      assert.equal(lastRequest.validSignature, true);
      if (reply.status === 403) await assert.rejects(realWorkflowServices.readWorkflowRunHistory(42, 50), { code: 'permission_denied' });
      else assert.deepEqual(await realWorkflowServices.readWorkflowRunHistory(42, 50), { status: 'unavailable' });
    }
  } finally {
    allowed = false;
    runtimeEnvironment = undefined;
  }
});

test('active Runtime diagnostics requires an authorised session, same origin, and an empty input', async () => {
  scopedRequests = [];
  const request = (origin, body = '{}') => new Request(`${app}/api/workflow-connections/adt-runtime/execution-path`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body,
  });
  allowed = false;
  assert.equal((await pathDiagnostic(request(app))).status, 401);
  allowed = true;
  assert.equal((await pathDiagnostic(request('https://elsewhere.invalid'))).status, 403);
  assert.equal((await pathDiagnostic(request(app, '{"repositoryId":7}'))).status, 400);
  assert.equal((await pathDiagnostic(request(app, ' '.repeat(1025) + '{}'))).status, 400);
  assert.deepEqual(scopedRequests, []);
  const accepted = await pathDiagnostic(request(app));
  assert.equal(accepted.status, 200);
  assert.match(accepted.headers.get('cache-control'), /no-store/);
  assert.deepEqual(scopedRequests, [access]);
});

test('Runner status and active detail use the authorised Runtime client without Worker Runner credentials', async () => {
  scopedRequests = [];
  const request = new Request(`${app}/diagnostics`);
  allowed = false;
  assert.equal((await runnerStatus(request)).status, 401);
  assert.equal((await runnerDiagnostics(request)).status, 401);
  assert.deepEqual(scopedRequests, []);
  allowed = true;
  const status = await runnerStatus(request);
  assert.match(status.headers.get('cache-control'), /no-store/);
  const value = await status.json();
  assert.equal(value.state, 'unavailable');
  assert.equal(value.capabilities.codexAvailable, false);
  assert.equal(value.auth.connected, true);
  const advanced = await runnerDiagnostics(request);
  assert.equal((await advanced.json()).appServerStartup.category, 'initialize_timeout');
  assert.deepEqual(scopedRequests, [42, 42]);
});
