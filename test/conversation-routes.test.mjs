import assert from 'node:assert/strict';
import test from 'node:test';
import { installTsxHook } from './render-tsx.mjs';

const requireTsx = installTsxHook();
const Module = requireTsx('node:module');
const originalLoad = Module._load;
const commands = [], launches = [];
const scope = { repositoryId: 42, installationId: 7, owner: 'acme', repository: 'private', branch: 'main', root: 'artifacts' };
const auth = { access: { ...scope, repo: scope.repository }, session: { githubId: 9, login: 'reviewer', id: 'browser-session' } };
let denied = false;
let fresh = false;
Module._load = function (name, parent, isMain) {
  if (name === '@/lib/auth') return { requireApiRepositoryAccess: async (_request, options) => {
    fresh = Boolean(options?.fresh);
    return denied ? Response.json({ error: 'Denied' }, { status: 403 }) : auth;
  } };
  if (name === '@/lib/workflow-run-admission') return {
    workflowRepositoryContext: access => { assert.equal(access.repositoryId, scope.repositoryId); return scope; },
    launchConversationTurn: async (access, input) => {
      assert.equal(access.repositoryId, scope.repositoryId);
      launches.push(input);
      return { conversationId: input.conversationId, turnId: input.turnId, runId: crypto.randomUUID(), replay: false };
    },
  };
  if (name === '@/lib/workflow-services') return { workflowRuntimeCommand: async command => {
    commands.push(command);
    if (command.operation === 'knowledge.from-action') return { id: 'proposal-id' };
    return { items: [], next: null };
  } };
  return originalLoad.call(this, name, parent, isMain);
};
let routes, detail, actions, interactions;
try {
  routes = requireTsx('../app/api/conversations/route.ts');
  detail = requireTsx('../app/api/conversations/[id]/route.ts');
  actions = requireTsx('../app/api/workflow-runs/[runId]/actions/[actionId]/route.ts');
  interactions = requireTsx('../app/api/workflow-runs/[runId]/interactions/[requestId]/route.ts');
} finally { Module._load = originalLoad; }

const submission = { conversationId: crypto.randomUUID(), turnId: crypto.randomUUID(), after: null,
  target: { kind: 'workflow', id: 'advisor' }, message: 'Original question.  \n' };
const resource = { params: Promise.resolve({ id: submission.conversationId }) };
const action = { params: Promise.resolve({ runId: crypto.randomUUID(), actionId: 'a'.repeat(64) }) };
const app = 'https://adt.example';
const post = (path, body, origin = app, method = 'POST') =>
  new Request(app + path, { method, headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

test('conversation and action mutations require current repository authority and same-origin intent', async () => {
  denied = true;
  assert.equal((await routes.POST(post('/api/conversations', submission))).status, 403);
  assert.equal((await detail.PATCH(post('/api/conversations/id', { title: 'Renamed' }, app, 'PATCH'), resource)).status, 403);
  assert.equal((await actions.POST(post('/api/workflow-runs/id/actions/id'), action)).status, 403);
  denied = false;
  assert.equal((await routes.POST(post('/api/conversations', submission, 'https://other.example'))).status, 403);
  assert.equal((await detail.PATCH(post('/api/conversations/id', { title: 'Renamed' }, 'https://other.example', 'PATCH'), resource)).status, 403);
  assert.equal((await actions.POST(post('/api/workflow-runs/id/actions/id', null, 'https://other.example'), action)).status, 403);
  assert.equal(commands.length + launches.length, 0);
});

test('Advisor is a repository-scoped history filter and sends the ordinary conversation submission', async () => {
  const list = await routes.GET(new Request(app + '/api/conversations?view=advisor&repositoryId=99&q=recent'));
  assert.equal(list.status, 200);
  assert.deepEqual(commands.at(-1), { operation: 'conversations.list', repositoryId: 42, scope, query: 'recent',
    target: { kind: 'workflow', id: 'advisor' }, before: undefined });
  const invalid = await routes.POST(post('/api/conversations', { ...submission, executionPolicy: 'unrestricted' }));
  assert.equal(invalid.status, 400);
  const launched = await routes.POST(post('/api/conversations', submission));
  assert.equal(launched.status, 201);
  assert.match(launched.headers.get('cache-control'), /no-store/);
  assert.deepEqual(launches.at(-1), { ...submission, exactTurnIds: [] });
  for (const view of ['/advisor', '/conversations']) {
    const request = post('/api/conversations', submission);
    request.headers.set('referer', app + view);
    assert.equal((await routes.POST(request)).status, 201);
  }
  assert.deepEqual(launches.at(-1), launches.at(-2));
});

test('a response action invokes only the exact stored identity with fresh user authority', async () => {
  assert.equal((await actions.POST(post('/api/workflow-runs/id/actions/id'), { params: Promise.resolve({
    runId: crypto.randomUUID(), actionId: 'Review & save to knowledge',
  }) })).status, 400);
  const response = await actions.POST(post('/api/workflow-runs/id/actions/id'), action);
  assert.equal(response.status, 200);
  assert.equal(fresh, true);
  assert.deepEqual(await response.json(), { id: 'proposal-id' });
  const command = commands.at(-1);
  assert.equal(command.operation, 'knowledge.from-action');
  assert.deepEqual(command.scope, scope);
  assert.equal(command.actor.githubId, 9);
  assert.match(command.actor.sessionId, /^[0-9a-f]{64}$/);
  assert.equal(command.actionId, 'a'.repeat(64));
});

test('interaction responses require current same-origin authority and derive the actor from the session', async () => {
  const runId = crypto.randomUUID(), requestId = crypto.randomUUID();
  const operation = { params: Promise.resolve({ runId, requestId }) };
  const path = '/api/workflow-runs/id/interactions/id';
  const response = { kind: 'edit', text: 'Exact edits.  \r\n' };
  const before = commands.length;
  denied = true;
  assert.equal((await interactions.POST(post(path, response), operation)).status, 403);
  denied = false;
  assert.equal((await interactions.POST(post(path, response, 'https://other.example'), operation)).status, 403);
  assert.equal((await interactions.POST(post(path, { ...response, actor: { githubId: 99 } }), operation)).status, 400);
  assert.equal(commands.length, before);
  const result = await interactions.POST(post(path, response), operation);
  assert.equal(result.status, 200);
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal(fresh, true);
  assert.deepEqual(commands.at(-1), { operation: 'runs.interaction', runId, requestId, scope, repositoryId: 42,
    submission: { actor: { githubId: 9, login: 'reviewer' }, response } });
});
