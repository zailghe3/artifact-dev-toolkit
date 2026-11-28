import test from 'node:test';
import assert from 'node:assert/strict';
import {installTsxHook} from './render-tsx.mjs';
import {fixture} from './helpers/agent-tool-fixture.mjs';
import {operateRuntimeTools} from '../lib/runtime-tool-decisions.ts';
import {AgentJournal} from '../lib/agent-journal.ts';
import {D1McpPolicyAuthority} from '../lib/mcp-policy-authority.ts';
import {GitHubToolDefinitionRepository} from '../lib/tool-definition-repository.ts';
import {browserMutationRejection} from '../lib/request-origin.ts';
const require=installTsxHook(),Module=require('node:module'),original=Module._load;let context;
const {RuntimeManagementError}=require('../lib/runtime-service-client.ts');
Module._load=function(request,...rest){if(request==='@/lib/auth')return{requireApiRepositoryAccess:async request=>browserMutationRejection(request)??(context.authorized?{access:{repositoryId:42},session:{login:context.actor}}:new Response(null,{status:401}))};if(request==='@/lib/workflow-services')return{workflowRuntimeCommand:async command=>{
 assert.equal(command.operation,'runs.tools');assert.equal(command.repositoryId,42);assert.equal(command.actor,context.actor);
 if(command.repositoryId!==context.repositoryId||command.runId!==context.f.options.runId)throw new Error('run_not_found');
 const env={ADT_TOOL_OPERATORS:'operator',ADT_TOOL_APPROVERS:context.approvers??'reviewer'};
 return operateRuntimeTools({...command,journal:new AgentJournal(context.f.db,undefined,env),repository:context.repository??{get:async()=>undefined},
  vault:context.f.vault,policies:new D1McpPolicyAuthority(context.f.db),
  env,wake:async()=>{context.wakes++}}).catch(error=>{
  if(error.message!=='definition_repository_unavailable')throw error;
  throw new RuntimeManagementError(error.message,{requestId:'x'.repeat(32),stage:'dispatch',result:'operation_rejected',
   httpStatus:503,authenticated:true,protocolCompatible:true,noncePersisted:true,accepted:true,dispatched:true,elapsedMs:1});
 });
}};return original.call(this,request,...rest)};
let route;try{route=require('../app/api/workflow-runs/[runId]/tools/route.ts')}finally{Module._load=original}
const request=(body,origin='https://adt.example')=>new Request('https://adt.example/api/workflow-runs/id/tools',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
async function pending(t){const f=await fixture(t);f.tool.key="artifact_search";f.tool.frozen={type:"builtin",name:"artifact_search"};await f.step();await f.step();const{approval,call}=await f.approval();await f.db.prepare('UPDATE agent_tool_approvals SET expires_at=? WHERE id=?').bind(Date.now()+60000,approval.id).run();context={f,actor:'reviewer',authorized:true,repositoryId:42,wakes:0};return{f,approval,call,params:{params:Promise.resolve({runId:f.options.runId})}}}
test('tool approval HTTP boundary authenticates, scopes the repository, rejects replacement arguments and records one exact decision',async t=>{const{f,approval,params}=await pending(t),body={action:'approval',approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved'};context.authorized=false;assert.equal((await route.POST(request(body),params)).status,401);context.authorized=true;context.repositoryId=99;assert.equal((await route.POST(request(body),params)).status,404);context.repositoryId=42;assert.equal((await route.POST(request({...body,arguments:{repo:'other'}}),params)).status,409);assert.equal((await route.POST(request(body,'https://other.example'),params)).status,403);assert.equal((await route.POST(request(body),params)).status,200);assert.equal((await route.POST(request(body),params)).status,200);assert.equal((await f.approval()).approval.status,'approved');assert.equal(f.executions,0);assert.equal(context.wakes,2)});
test('reconciliation HTTP boundary requires an operator and evidence and cannot modify an unambiguous call',async t=>{const{f,call,params}=await pending(t),body={action:'reconcile',invocationId:call.id,admissionId:crypto.randomUUID(),decisionId:crypto.randomUUID(),decision:'success',basis:'Verified in target audit',result:'verified'};assert.equal((await route.POST(request(body),params)).status,403);context.actor='operator';assert.equal((await route.POST(request(body),params)).status,409);await f.db.prepare("UPDATE agent_tool_invocations SET state='unknown',admission_id=? WHERE id=?").bind(body.admissionId,call.id).run();await f.db.prepare("UPDATE agent_continuations SET state='reconciliation' WHERE id=?").bind(f.options.id).run();assert.equal((await route.POST(request({...body,basis:''}),params)).status,409);assert.equal((await route.POST(request({...body,admissionId:crypto.randomUUID()}),params)).status,409);assert.equal((await f.journal.call(call.id)).state,'unknown');assert.equal((await route.POST(request(body),params)).status,200);assert.equal((await f.journal.call(call.id)).state,'completed');assert.equal((await route.POST(request(body),params)).status,200);const visible=await route.GET(new Request('https://adt.example'),params),result=await visible.json();assert.equal(result.operator,true);assert.equal(result.tools[0].state,'completed');assert.equal(result.tools[0].reconciliation[0].basis,'Verified in target audit');assert.ok(result.tools[0].events.some(event=>event.kind==='reconciliation'));assert.ok(result.tools[0].events.some(event=>event.kind==='proposed_call'));assert.ok(result.tools[0].events.some(event=>event.kind==='validation'))});

test('tool decision API requires explicitly delegated approvers independently of repository access and operator status',async t=>{
 const{f,approval,params}=await pending(t),body={action:'approval',approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved'};
 context.actor='member';assert.equal((await route.POST(request(body),params)).status,403);let view=await(await route.GET(new Request('https://adt.example'),params)).json();assert.equal(view.tools[0].approval.canDecide,false);
 context.actor='operator';assert.equal((await route.POST(request({...body,decision:'rejected'}),params)).status,403);
 context.actor='reviewer';context.approvers='';assert.equal((await route.POST(request(body),params)).status,403);assert.equal((await f.approval()).approval.status,'pending');
 context.approvers='reviewer';view=await(await route.GET(new Request('https://adt.example'),params)).json();assert.equal(view.tools[0].approval.canDecide,true);assert.equal((await route.POST(request(body),params)).status,200);
});


test('an unverified live MCP authority exposes rejection only and persists an idempotent negative decision',async t=>{
 const{f,approval,call,params}=await pending(t);await f.db.prepare("UPDATE agent_tool_invocations SET tool_key='mcp:docs:search',frozen_json=? WHERE id=?").bind(JSON.stringify({serverId:'docs'}),call.id).run();
 const view=await(await route.GET(new Request('https://adt.example'),params)).json();assert.equal(view.tools[0].approval.canDecide,false);assert.equal(view.tools[0].approval.canReject,true);
 const body={action:'approval',approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved'};assert.equal((await route.POST(request(body),params)).status,409);assert.equal((await f.approval()).approval.status,'pending');
 body.decision='rejected';assert.equal((await route.POST(request(body),params)).status,200);assert.equal((await route.POST(request(body),params)).status,200);assert.equal((await f.approval()).approval.status,'rejected');assert.equal(f.executions,0);
 assert.equal((await route.POST(request({...body,decision:'approved'}),params)).status,409);
});

test('a GitHub definition outage keeps an MCP approval pending and returns a safe 503',async t=>{
 const{f,approval,call,params}=await pending(t);
 await f.db.prepare("UPDATE agent_tool_invocations SET tool_key='mcp:docs:search',frozen_json=? WHERE id=?")
  .bind(JSON.stringify({serverId:'docs'}),call.id).run();
 context.repository=new GitHubToolDefinitionRepository(async()=>new Response('private upstream details',{status:503}));
 const response=await route.POST(request({action:'approval',approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved'}),params);
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{code:'definition_repository_unavailable',error:'The definition repository is temporarily unavailable.'});
 assert.equal((await f.approval()).approval.status,'pending');
 assert.equal(context.wakes,0);
 assert.equal(f.executions,0);
});

for(const boundary of ['delegation','frozen_reviewers','expired','cancelled','generation','wrong_run'])test(`safe rejection after authority loss still enforces ${boundary}`,async t=>{
 const{f,approval,call,params}=await pending(t);await f.db.prepare("UPDATE agent_tool_invocations SET tool_key='mcp:docs:search',frozen_json=? WHERE id=?").bind(JSON.stringify({serverId:'docs'}),call.id).run();
 if(boundary==='delegation')context.approvers='';
 if(boundary==='frozen_reviewers')await f.db.prepare('UPDATE agent_tool_approvals SET reviewers_json=? WHERE id=?').bind('["other"]',approval.id).run();
 if(boundary==='expired')await f.db.prepare('UPDATE agent_tool_approvals SET expires_at=0 WHERE id=?').bind(approval.id).run();
 if(boundary==='cancelled')await f.db.prepare("UPDATE workflow_runs SET cancel_requested_at='now' WHERE id=?").bind(f.options.runId).run();
 if(boundary==='generation')await f.db.prepare('UPDATE workflow_runs SET workflow_generation=2 WHERE id=?').bind(f.options.runId).run();
 const target=boundary==='wrong_run'?{params:Promise.resolve({runId:crypto.randomUUID()})}:params;
 const response=await route.POST(request({action:'approval',approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'rejected'}),target);assert.equal(response.status,boundary==='wrong_run'?404:['delegation','frozen_reviewers'].includes(boundary)?403:409);assert.equal((await f.approval()).approval.status,'pending');assert.equal(f.executions,0);
 const view=await(await route.GET(new Request('https://adt.example'),params)).json();if(boundary!=='wrong_run')assert.equal(view.tools[0].approval.canReject,false);
});

test('sensitive native disclosure requires explicit acknowledgement at the authenticated exact-call approval boundary',async t=>{
 const {f,call,approval,params}=await pending(t);
 await f.db.prepare('UPDATE agent_tool_invocations SET tool_key=?,alias=?,frozen_json=?,arguments_json=? WHERE id=?').bind('adt_execution_content_read','adt_execution_content_read',JSON.stringify({type:'builtin',name:'adt_execution_content_read',version:1}),JSON.stringify({runId:f.options.runId,selection:'input',maxChars:100}),call.id).run();
 const body={action:'approval',approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved'};
 assert.equal((await route.POST(request(body),params)).status,403);assert.equal((await f.approval()).approval.status,'pending');assert.equal(f.executions,0);
 assert.equal((await route.POST(request({...body,sensitiveDisclosureAcknowledged:false}),params)).status,409);
 context.actor='member';assert.equal((await route.POST(request({...body,sensitiveDisclosureAcknowledged:true}),params)).status,403);context.actor='reviewer';
 assert.equal((await route.POST(request({...body,sensitiveDisclosureAcknowledged:true}),params)).status,200);assert.equal((await f.approval()).approval.status,'approved');assert.equal(f.executions,0);
});
