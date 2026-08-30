import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import {agentDefinitionSchema,compileWorkflowV2ExecutionPlan,workflowDefinitionV2Schema} from '../lib/workflow-definitions.ts';
import { resolveConnection, safeConnectionSnapshot } from '../lib/workflow-connections.ts';
import { D1WorkflowRunStorage } from '../lib/workflow-d1-storage.ts';
import { getWorkflowRunDetail } from '../lib/workflow-run-detail.ts';
import {newLangGraphWorkflowRun,WORKFLOW_LAUNCH_STALE_MS} from '../lib/workflow-storage.ts';

async function database() {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: { DB: 'run-detail-test' } });
  const db = await mf.getD1Database('DB');
  for (const migration of ['0003_create_workflow_runs.sql', '0007_add_provider_transport_diagnostics.sql','0008_add_provider_transport_reason.sql','0010_add_workflow_run_repository_context.sql','0012_add_graph_activation_identity.sql','0014_add_workflow_composition_snapshot.sql']) {
    const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
    await db.batch(sql.split(';').map(value => value.trim()).filter(Boolean).map(value => db.prepare(value)));
  }
  return { mf, db };
}

function run(id) {const agent=agentDefinitionSchema.parse({schemaVersion:2,id:'observer',name:'Observer',description:'',status:'draft',prompt:{source:'custom',text:'Observe'},connectionKey:'deterministic-test'}),workflow=workflowDefinitionV2Schema.parse({schemaVersion:2,id:'observed',name:'Observed',description:'',status:'draft',nodes:[{id:'observe',blockType:'agent',blockVersion:1,config:{agentId:agent.id}}],edges:[],limits:{maxStepExecutions:1}});return newLangGraphWorkflowRun({id,workflow,executionPlan:compileWorkflowV2ExecutionPlan(workflow,[agent]),revision:'sha',agents:[agent],connections:[safeConnectionSnapshot(resolveConnection('deterministic-test',{NODE_ENV:'test'}))],initialInput:'durable input',clientIdempotencyKey:`client-${id}`});}

test('the run page and API route delegate to the same reconciliation-aware loader', async () => {
  const [page, route] = await Promise.all([
    readFile(new URL('../app/workflows/runs/[runId]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/workflow-runs/[runId]/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /Provider diagnostics/);
  for (const label of ["Client request ID","Transport outcome","Transport reason","Request duration","Provider request ID","HTTP status","Provider processing"]) assert.match(page,new RegExp(label));
  assert.doesNotMatch(page,/raw provider body|authorization|cookie/i);
  for (const source of [page, route]) {
    assert.match(source, /import \{getWorkflowRunDetail\} from "@\/lib\/workflow-run-detail"/);
    assert.match(source, /await getWorkflowRunDetail\(/);
    assert.doesNotMatch(source, /reconcileWorkflowLaunch|getWorkflowRunStorage/);
  }
});
