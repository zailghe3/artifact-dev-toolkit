import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeAdtToolDefinitions,authorizeNativeAdtTool} from '../lib/adt-data-authority.ts';
import {ADT_DATA_TOOLS,adtDataArgumentSchemas,adtDataModelSchemas} from '../lib/adt-data-contract.ts';
import {validateToolArguments} from '../adt-runtime/src/agent-contract.ts';
import {context,database} from './support/advisor-fixtures.mjs';

import {nativeFixture} from './support/native-adt-fixture.mjs';

test('each native tool follows ordinary D1 proposal, admission, result and recovery semantics',async t=>{
 const db=await database(t);
 for(const tool of ADT_DATA_TOOLS){const args=tool==='adt_workflow_read'?{workflowId:'review'}:tool==='adt_execution_read'?{runId:crypto.randomUUID()}:{};const f=await nativeFixture(t,{tool,arguments:args,db});
  const outcome=await f.finish();assert.equal(outcome.state,'completed');assert.equal(f.reads,1);assert.equal(f.authorizations,1);assert.equal(f.models,2);const calls=await f.journal.calls(f.id);assert.equal(calls.length,1);assert.equal(calls[0].state,'completed');assert.equal(calls[0].tool_key,tool);assert.doesNotMatch(calls[0].result_json,/SENSITIVE_/);
  assert.equal((await f.step()).state,'completed');assert.equal(f.reads,1);assert.equal(f.models,2);
  assert.equal(adtDataArgumentSchemas[tool].safeParse({...args,repositoryId:99}).success,false);validateToolArguments(adtDataModelSchemas[tool],args);
 }
});
test('all eligible providers and ordinary Agents can use explicitly assigned native ADT tools',async t=>{
 const db=await database(t);
 for(const provider of ['openai-agents','anthropic-messages','ollama-chat']){const f=await nativeFixture(t,{provider,advisor:false,db});assert.equal((await f.finish()).outputText,'Analysis grounded in review');assert.equal(f.reads,1);const metrics=await f.data.execute('adt_execution_metrics',{},context);assert.equal(metrics.tokens.available,true);assert.ok(metrics.tokens.recordedTotal>=40);assert.equal(metrics.tokens.coverage,'journaled_provider_reports_only')}
});
test('current native authority checks every frozen repository dimension, exact attempt, generation and explicit grant',async t=>{
 const f=await nativeFixture(t);await f.step();const original=await f.storage.getRun(f.value.id);authorizeNativeAdtTool(original,f.scope,'adt_workflow_read',context);
 for(const change of [d=>d.run.status='cancelled',d=>d.run.status='cancelling',d=>d.run.cancelRequestedAt='now',d=>d.run.workflowGeneration=2,d=>d.attempts[0].attempt=2,d=>d.attempts[0].status='succeeded',d=>d.attempts[0].connectionKey='other',d=>d.attempts[0].graphActivationId='other',d=>d.run.agentSnapshots.analyst.tools=[]]){const detail=structuredClone(original);change(detail);assert.throws(()=>authorizeNativeAdtTool(detail,f.scope,'adt_workflow_read',context))}
 for(const key of Object.keys(context)){const other={...context,[key]:typeof context[key]==='number'?999:'other'};assert.throws(()=>authorizeNativeAdtTool(original,f.scope,'adt_workflow_read',other))}
});
test('native execution cannot bypass approvals, current authority revocation or Advisor read-only limits',async t=>{
 const db=await database(t),f=await nativeFixture(t,{approval:'approval',db});await f.step();await f.step();assert.equal(f.reads,0);const call=(await f.journal.calls(f.id))[0],approval=await f.journal.approval(call);assert.equal(approval.status,'pending');
 await f.journal.decide({runId:f.value.id,approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved',actor:'reviewer'});f.nativeData.authorize=async()=>{throw Error('SENSITIVE_REVOKED')};await f.step();assert.equal(f.reads,0);assert.equal((await f.journal.call(call.id)).state,'denied');assert.doesNotMatch((await f.journal.call(call.id)).result_json,/SENSITIVE_/);
 const unassigned=await nativeFixture(t,{tools:['adt_executions_list'],db});assert.equal((await unassigned.finish()).state,'failed');assert.equal(unassigned.reads,0);
 const unsafe=await nativeFixture(t,{db});await unsafe.step();const detail=await unsafe.storage.getRun(unsafe.value.id);detail.run.agentSnapshots.analyst.tools.push({type:'mcp',serverId:'writer',toolName:'invoke_workflow'});await db.prepare('UPDATE workflow_runs SET agent_snapshots_json=? WHERE id=?').bind(JSON.stringify(detail.run.agentSnapshots),unsafe.value.id).run();await assert.rejects(unsafe.step(),/advisor_read_only_required/);assert.equal(unsafe.reads,0);
 const cancelled=await nativeFixture(t,{db});await cancelled.step();await cancelled.storage.requestCancellation(cancelled.value.id);assert.equal((await cancelled.step()).state,'cancelled');assert.equal(cancelled.reads,0);
});
test('native schemas and grants expose distinct names without automatic assignment',()=>{assert.equal(nativeAdtToolDefinitions(undefined).length,0);assert.deepEqual(nativeAdtToolDefinitions(['adt_workflow_read']).map(t=>t.alias),['adt_workflow_read']);assert.equal(nativeAdtToolDefinitions([{type:'mcp',serverId:'x',toolName:'adt_workflow_read'}]).length,0)});

test('native tools retain the shared security gate and aggregate execution budget',async t=>{
 const {fixture}=await import('./helpers/agent-tool-fixture.mjs');
 const f=await fixture(t),tool=nativeAdtToolDefinitions(['adt_workflows_list'])[0];let reads=0;
 Object.assign(f.options,{tools:[tool],agent:{...f.options.agent,tools:['adt_workflows_list']},progress:async()=>({version:1,text:'',calls:[{id:'native-call',name:tool.alias,arguments:{}}]}),security:async()=>{throw Object.assign(Error('denied'),{category:'security_denied'})},execute:async()=>{reads++;return{results:[]}}});
 await f.step();await f.step();assert.equal(reads,0);assert.equal((await f.journal.calls(f.options.id))[0].state,'denied');
 const bounded=await fixture(t);Object.assign(bounded.options,{tools:[tool],agent:{...bounded.options.agent,tools:['adt_workflows_list'],executionLimits:{toolExecutions:1,toolProposals:2}},progress:async()=>({version:1,text:'',calls:[{id:'first',name:tool.alias,arguments:{}},{id:'second',name:tool.alias,arguments:{}}]}),execute:async()=>{reads++;return{results:[]}}});
 await bounded.step();await bounded.step();const outcome=await bounded.step();assert.equal(outcome.state,'failed');assert.equal(reads,1);assert.equal((await bounded.journal.get(bounded.options.id)).tool_executions,1);
});
