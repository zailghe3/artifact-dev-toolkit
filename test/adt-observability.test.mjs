import test from 'node:test';
import assert from 'node:assert/strict';
import {AdtDataTools} from '../lib/adt-data-tools.ts';
import {nativeAdtToolDefinitions} from '../lib/adt-data-authority.ts';
import {SENSITIVE_ADT_TOOLS,NATIVE_ADT_TOOLS,adtDataArgumentSchemas,adtDataModelSchemas} from '../lib/adt-data-contract.ts';
import {validateToolArguments,evaluateToolPolicy} from '../adt-runtime/src/agent-contract.ts';
import {D1WorkflowRunStorage} from '../lib/workflow-d1-storage.ts';
import {InMemoryWorkflowDefinitionRepository} from '../lib/workflow-definition-repository.ts';
import {toolApprovalAuthority} from '../lib/agent-tool-approval-authority.ts';
import {requireSensitiveReadApproval} from '../lib/adt-sensitive-approval.ts';
import {assertAdvisorRunReadOnly} from '../lib/advisor-policy.ts';
import {nativeFixture} from './support/native-adt-fixture.mjs';
import {context,agent,run,database} from './support/advisor-fixtures.mjs';

test('each additional grant is independent, defaults to explicit human approval, and is in the closed Advisor allowlist',()=>{
 assert.equal(nativeAdtToolDefinitions(undefined).length,0);
 for(const name of NATIVE_ADT_TOOLS){const tools=nativeAdtToolDefinitions([name]);assert.equal(tools.length,1);assert.equal(tools[0].key,name);assert.equal(evaluateToolPolicy([tools[0].policy],{}),SENSITIVE_ADT_TOOLS.includes(name)?'approval':'automatic');const value=run();value.agentSnapshots.analyst.tools=[name];assert.doesNotThrow(()=>assertAdvisorRunReadOnly({...value,advisorContext:{version:1,readOnly:true,override:null}}));assert.equal(adtDataArgumentSchemas[name].safeParse({repositoryId:99}).success,false)}
 assert.throws(()=>assertAdvisorRunReadOnly({...run(),advisorContext:{version:1,readOnly:true,override:null},agentSnapshots:{analyst:{...agent,tools:['adt_advisor_knowledge_publish']}}}),/advisor_read_only_required/);
});
test('current artifact and frozen historical prompts have distinct provenance and never include credentials/configuration',async t=>{
 const db=await database(t),storage=new D1WorkflowRunStorage(db),repo=new InMemoryWorkflowDefinitionRepository();await repo.createAgent(agent);const value=run();await storage.createRun(value);
 const tools=new AdtDataTools(db,repo,undefined,async id=>({body:'Current referenced prompt',path:`prompts/${id}.md`,revision:'artifact-sha'}));
 const historical=await tools.execute('adt_agent_prompt_read',{agentId:agent.id,runId:value.id,maxChars:4},context);assert.equal(historical.source,'frozen_execution');assert.equal(historical.prompt.text,'SENS');assert.equal(historical.prompt.nextOffset,4);
 const current=await tools.execute('adt_agent_prompt_read',{agentId:agent.id},context);assert.equal(current.source,'current_git');assert.equal(current.prompt.text,'SENSITIVE_PROMPT');assert.notEqual(current.revision,historical.revision);
 const old=await repo.getAgent(agent.id);await repo.updateAgent({...old.definition,prompt:{source:'artifact',artifactId:'system'}},old.fileSha);const resolved=await tools.execute('adt_agent_prompt_read',{agentId:agent.id},context);assert.equal(resolved.prompt.text,'Current referenced prompt');assert.equal(resolved.artifactRevision,'artifact-sha');assert.equal((await tools.execute('adt_agent_prompt_read',{agentId:agent.id,runId:value.id},context)).prompt.text,'SENSITIVE_PROMPT');
 const unavailable=await new AdtDataTools(db,repo).execute('adt_agent_prompt_read',{agentId:agent.id},context);assert.equal(unavailable.prompt.available,false);
 await db.prepare('UPDATE workflow_runs SET agent_snapshots_json=? WHERE id=?').bind('{"analyst":{"masterPrompt":"unvalidated"}}',value.id).run();assert.equal((await tools.execute('adt_agent_prompt_read',{agentId:agent.id,runId:value.id},context)).reason,'historical_prompt_unavailable');
 assert.doesNotMatch(JSON.stringify([historical,current,resolved]),/sec_[a-z]{43}|credential|providerConfiguration/);
});
test('execution content and diagnostics are narrowly projected, paginated and isolated in every repository dimension',async t=>{
 const db=await database(t),storage=new D1WorkflowRunStorage(db),value=run(),tools=new AdtDataTools(db,{});await storage.createRun(value);await storage.ensureGraphActivation(value.id,'analyse','activation');await storage.claimGraphNode(value.id,'analyse','Selected step input','activation');
 await storage.recordProviderDiagnostics(value.id,'analyse',1,1,{clientRequestId:'SENSITIVE_REQUEST',requestId:'https://private.invalid',elapsedMs:50,httpStatus:504,outcome:'timeout'});await storage.failStep(value.id,'analyse',1,1,{category:'provider_timeout',safeMessage:'SENSITIVE_RAW_EXCEPTION token=abcdefghijklmnopqrstuvwxyz',retryable:true});await storage.createAutomaticRetryAttempt(value.id,'analyse','activation');await storage.claimGraphNode(value.id,'analyse','Retry input','activation');await storage.completeStep(value.id,'analyse',1,2,'Intermediate output');await storage.completeRun(value.id,'analyse','Final output');
 const content=await tools.execute('adt_execution_content_read',{runId:value.id,selection:'steps',limit:1,maxChars:8},context);assert.equal(content.results[0].input.text,'Selected');assert.equal(content.results[0].input.truncated,true);assert.equal(content.nextOffset,1);assert.equal(content.kind,'intermediate_steps');assert.equal(content.results[0].activationId,'activation');
 const second=await tools.execute('adt_execution_content_read',{runId:value.id,selection:'steps',limit:1,offset:1},context);assert.equal(second.results[0].attempt,2);assert.equal(second.results[0].output.text,'Intermediate output');assert.equal(second.nextOffset,null);
 assert.equal((await tools.execute('adt_execution_content_read',{runId:value.id,selection:'final_output'},context)).content.text,'Final output');
 const errors=await tools.execute('adt_execution_errors_read',{runId:value.id,limit:1},context);assert.equal(errors.results[0].meaning,'timeout');assert.equal(errors.results[0].retryable,true);assert.equal(errors.results[0].provider.httpStatus,504);assert.doesNotMatch(JSON.stringify(errors),/SENSITIVE_|private.invalid|token=/);
 await db.prepare('UPDATE workflow_step_attempts SET failure_category=?,provider_transport_reason=? WHERE run_id=? AND attempt=1').bind('untrusted-provider-category','unknown',value.id).run();assert.equal((await tools.execute('adt_execution_errors_read',{runId:value.id},context)).results[0].category,null);
 for(const key of Object.keys(context)){const other={...context,[key]:typeof context[key]==='number'?999:'other'};for(const name of ['adt_execution_content_read','adt_execution_errors_read','adt_tool_execution_read','adt_agent_prompt_read']){const args=name==='adt_agent_prompt_read'?{agentId:agent.id,runId:value.id}:name==='adt_execution_content_read'?{runId:value.id,selection:'input'}:{runId:value.id};assert.deepEqual(await tools.execute(name,args,other),{available:false,reason:'not_found'})}}
 await db.prepare('UPDATE workflow_runs SET initial_input=? WHERE id=?').bind('token=abcdefghijklmnopqrstuvwxyz123456',value.id).run();assert.equal((await tools.execute('adt_execution_content_read',{runId:value.id,selection:'input'},context)).content.reason,'secret_safety_check');
 for(const args of [{limit:21},{offset:-1},{maxChars:4001},{runId:'not-id'}])await assert.rejects(tools.execute('adt_execution_content_read',{runId:value.id,selection:'input',...args},context));
});
test('sensitive tools cannot read before approval, after denial/revocation, or without an exact consumed admission',async t=>{
 const db=await database(t);
 for(const tool of SENSITIVE_ADT_TOOLS){const args=tool==='adt_agent_prompt_read'?{agentId:agent.id}:tool==='adt_execution_content_read'?{runId:crypto.randomUUID(),selection:'input'}:{runId:crypto.randomUUID()};validateToolArguments(adtDataModelSchemas[tool],args);
  const f=await nativeFixture(t,{db,tool,arguments:args,tools:[tool]});await f.step();await f.step();assert.equal(f.reads,0);const call=(await f.journal.calls(f.id))[0],approval=await f.journal.approval(call);assert.equal(approval.status,'pending');
  await assert.rejects(requireSensitiveReadApproval(f.journal,call,'forged'),/permission_denied/);
  await toolApprovalAuthority({journal:f.journal,runId:f.value.id,invocationId:call.id,decision:'approved',actor:'reviewer',repositoryId:42,repository:{get(){assert.fail('Native approval must not use MCP authority')}},policies:{},vault:{}});
  await f.journal.decide({runId:f.value.id,approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved',actor:'reviewer'});assert.equal((await f.finish()).state,'completed');assert.equal(f.reads,1);assert.equal((await f.step()).state,'completed');assert.equal(f.reads,1);
 }
 const denied=await nativeFixture(t,{db,tool:'adt_agent_prompt_read',arguments:{agentId:agent.id},tools:['adt_agent_prompt_read']});await denied.step();await denied.step();const call=(await denied.journal.calls(denied.id))[0],approval=await denied.journal.approval(call);await denied.journal.decide({runId:denied.value.id,approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'rejected',actor:'reviewer'});await denied.finish();assert.equal(denied.reads,0);
 const missing=await nativeFixture(t,{db,tool:'adt_agent_prompt_read',arguments:{agentId:agent.id},tools:['adt_execution_errors_read']});assert.equal((await missing.finish()).state,'failed');assert.equal(missing.reads,0);
});
test('tool observations preserve journal identities/states and restrict arbitrary payload keys/text without changing any invocation',async t=>{
 const f=await nativeFixture(t,{tool:'adt_workflows_list',arguments:{}});await f.finish();const call=(await f.journal.calls(f.id))[0];await f.db.prepare('UPDATE agent_tool_invocations SET arguments_json=?,result_json=? WHERE id=?').bind(JSON.stringify({'SENSITIVE_KEY':'SENSITIVE_VALUE',limit:3}),JSON.stringify({ok:true,result:{'https://private.invalid':'SENSITIVE_CONTENT',count:2}}),call.id).run();
 const tools=f.data;for(const state of ['proposed','validated','waiting','eligible','admitted','completed','denied','unknown','cancelled']){await f.db.prepare('UPDATE agent_tool_invocations SET state=? WHERE id=?').bind(state,call.id).run();const result=await tools.execute('adt_tool_execution_read',{runId:f.value.id,invocationId:call.id,includePayload:true},context);assert.equal(result.results[0].state,state);assert.equal(result.results[0].ambiguous,state==='unknown');assert.equal(result.results[0].invocationId,call.id);assert.equal(result.results[0].activationId,'activation');assert.equal(result.results[0].agentId,'analyst');assert.doesNotMatch(JSON.stringify(result),/SENSITIVE_|private.invalid/);assert.equal((await f.journal.call(call.id)).state,state)}
 await assert.rejects(tools.execute('adt_tool_execution_read',{runId:f.value.id,includePayload:true},context));
 await f.db.prepare('UPDATE agent_tool_invocations SET tool_key=?,arguments_json=?,result_json=? WHERE id=?').bind('mcp:server:read',JSON.stringify({account:123456789}),JSON.stringify({result:987654321}),call.id).run();const external=await tools.execute('adt_tool_execution_read',{runId:f.value.id,invocationId:call.id,includePayload:true},context);assert.equal(external.results[0].payload.arguments.available,false);assert.doesNotMatch(JSON.stringify(external),/123456789|987654321/);
 const other=await tools.execute('adt_tool_execution_read',{runId:f.value.id,invocationId:'0'.repeat(64)},context);assert.deepEqual(other.results,[]);
});

test('sensitive approval cannot survive approver revocation, repository revocation or cancelled execution',async t=>{
 const db=await database(t);
 for(const revoke of [f=>{f.base.env.ADT_TOOL_APPROVERS=''},f=>{f.nativeData.authorize=async()=>{throw Error('revoked')}},async f=>{await f.storage.requestCancellation(f.value.id)}]){
  const f=await nativeFixture(t,{db,tool:'adt_agent_prompt_read',arguments:{agentId:agent.id},tools:['adt_agent_prompt_read']});await f.step();await f.step();const call=(await f.journal.calls(f.id))[0],approval=await f.journal.approval(call);
  await f.journal.decide({runId:f.value.id,approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved',actor:'reviewer'});await revoke(f);await f.step();assert.equal(f.reads,0);
 }
});
