import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { agentDefinitionSchema, buildSequentialWorkflow } from '../lib/workflow-definitions.ts';
import { resolveConnection, safeConnectionSnapshot } from '../lib/workflow-connections.ts';
import { D1WorkflowRunStorage } from '../lib/workflow-d1-storage.ts';
import { getWorkflowRunDetail } from '../lib/workflow-run-detail.ts';
import { newWorkflowRun, WORKFLOW_LAUNCH_STALE_MS } from '../lib/workflow-storage.ts';

async function database() {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: { DB: 'run-detail-test' } });
  const db = await mf.getD1Database('DB');
  const sql = await readFile(new URL('../migrations/0003_create_workflow_runs.sql', import.meta.url), 'utf8');
  await db.batch(sql.split(';').map(value => value.trim()).filter(Boolean).map(value => db.prepare(value)));
  return { mf, db };
}

function run(id) {
  const agent = agentDefinitionSchema.parse({ schemaVersion: 1, id: 'observer', name: 'Observer', description: '', status: 'draft', masterPrompt: 'Observe', connectionKey: 'deterministic-test' });
  return newWorkflowRun({ id, workflow: buildSequentialWorkflow({ id: 'observed', name: 'Observed', agents: [agent] }), revision: 'sha', agents: [agent], connections: [safeConnectionSnapshot(resolveConnection('deterministic-test', { NODE_ENV: 'test' }))], initialInput: 'durable input', clientIdempotencyKey: `client-${id}` });
}

test('the page run-detail loader waits for the lease then reuses the reserved Workflow id', async () => {
  const { mf, db } = await database();
  let time = Date.parse('2026-01-01T00:00:00.000Z');
  const clock = () => new Date(time).toISOString();
  const storage = new D1WorkflowRunStorage(db, clock);
  const value = run('page-abandoned');
  await storage.createRun(value);
  await storage.claimWorkflowLaunch(value.id, 1, `${value.id}-g1`);
  const ids = [];
  const binding = { create: async ({ id }) => { ids.push(id); return { id }; } };

  let detail = await getWorkflowRunDetail(value.id, { storage, binding });
  assert.equal(ids.length, 0);
  assert.equal(detail.run.workflowLaunchState, 'launching');

  time += WORKFLOW_LAUNCH_STALE_MS + 1;
  detail = await getWorkflowRunDetail(value.id, { storage, binding });
  assert.deepEqual(ids, [`${value.id}-g1`]);
  assert.equal(detail.run.workflowLaunchState, 'attached');
  assert.equal(detail.run.workflowInstanceId, `${value.id}-g1`);
  await mf.dispose();
});

test('simultaneous stale page observations have one effective Workflow creation', async () => {
  const { mf, db } = await database();
  let time = Date.parse('2026-01-01T00:00:00.000Z');
  const clock = () => new Date(time).toISOString();
  const initial = new D1WorkflowRunStorage(db, clock);
  const value = run('page-race');
  await initial.createRun(value);
  await initial.claimWorkflowLaunch(value.id, 1, `${value.id}-g1`);
  time += WORKFLOW_LAUNCH_STALE_MS + 1;
  const ids = [];
  const binding = { create: async ({ id }) => { ids.push(id); return { id }; } };

  const [left, right] = await Promise.all([
    getWorkflowRunDetail(value.id, { storage: new D1WorkflowRunStorage(db, clock), binding }),
    getWorkflowRunDetail(value.id, { storage: new D1WorkflowRunStorage(db, clock), binding }),
  ]);
  assert.deepEqual(ids, [`${value.id}-g1`]);
  assert.equal(left.run.workflowLaunchState, 'attached');
  assert.equal(right.run.workflowLaunchState, 'attached');
  await mf.dispose();
});

test('the run page and API route delegate to the same reconciliation-aware loader', async () => {
  const [page, route] = await Promise.all([
    readFile(new URL('../app/workflows/runs/[runId]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/workflow-runs/[runId]/route.ts', import.meta.url), 'utf8'),
  ]);
  for (const source of [page, route]) {
    assert.match(source, /import \{getWorkflowRunDetail\} from "@\/lib\/workflow-run-detail"/);
    assert.match(source, /await getWorkflowRunDetail\(/);
    assert.doesNotMatch(source, /reconcileWorkflowLaunch|getWorkflowRunStorage/);
  }
});
