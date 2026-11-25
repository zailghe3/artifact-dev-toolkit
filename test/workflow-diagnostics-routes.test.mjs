import assert from 'node:assert/strict';
import test from 'node:test';
import { installTsxHook } from './render-tsx.mjs';

const require = installTsxHook();
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const app = 'https://adt.example';
const access = { repositoryId: 42 };

let allowed = false;
let authorizationError;
let history = { status: 'unavailable' };
let scopedRequests = [];
const runtimeClient = {
  capabilities: async () => ({ protocolVersion: 1, runnerVersion: 'a'.repeat(40), releaseMetadata: 'legacy',
    codexAvailable: false, deviceAuth: false, jobExecution: true }),
  authStatus: async () => ({ connected: true, authMode: 'chatgpt' }),
  authEnvironmentDiagnostics: async () => ({ codexAppServerReady: false, appServerStartup: { category: 'initialize_timeout' } }),
};
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
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
  };
  return originalLoad.call(this, name, parent, isMain);
};
let pages, pathDiagnostic, runnerStatus, runnerDiagnostics;
try {
  pages = ['page', 'runs/page'].map(path => require(`../app/workflows/${path}.tsx`).default);
  pathDiagnostic = require('../app/api/workflow-connections/adt-runtime/execution-path/route.ts').POST;
  runnerStatus = require('../app/api/workflow-connections/codex-runner/status/route.ts').GET;
  runnerDiagnostics = require('../app/api/workflow-connections/codex-runner/diagnostics/route.ts').GET;
} finally {
  Module._load = originalLoad;
}

test('Workflow pages render the retryable outage state and show an empty history only after successful reads', async () => {
  for (const [index, page] of pages.entries()) {
    history = { status: 'unavailable' };
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, await page()));
    assert.match(html, /Workflow service unavailable/);
    assert.match(html, /Retry loading history/);
    assert.match(html, new RegExp(`action="/workflows${index === 0 ? '' : '/runs'}"`));
    assert.doesNotMatch(html, /no (?:active|workflow) runs/i);
    history = { status: 'available', runs: [] };
    const empty = renderToStaticMarkup(await page());
    assert.match(empty, /no workflow runs yet/i);
    assert.doesNotMatch(empty, /Workflow service unavailable/);
  }
  assert.deepEqual(scopedRequests, [[42, 10], [42, 10], [42, 50], [42, 50]]);
  const denied = new Error('repository access denied');
  authorizationError = denied;
  try { await assert.rejects(pages[0](), denied); }
  finally { authorizationError = undefined; }
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
