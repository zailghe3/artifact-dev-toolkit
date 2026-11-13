import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/agent-tool-fixture.mjs';
import {AgentJournal} from '../lib/agent-journal.ts';
import {hasToolRole} from '../lib/agent-tool-roles.ts';
import {toolApprovalAuthority} from '../lib/agent-tool-approval-authority.ts';
import {D1McpPolicyAuthority} from '../lib/mcp-policy-authority.ts';
import {policyFixture} from './helpers/mcp-policy-fixture.mjs';
import {createMcpServer,discoverMcpServer,updateMcpServer} from '../lib/mcp-tool-service.ts';
import {freezeAuthorizedMcpTools} from '../lib/mcp-tool-authority.ts';
const action=(f,approval,actor='reviewer')=>({runId:f.options.runId,approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved',actor});

test('approver role defaults to nobody and neither operator nor policy administrator implies it',async t=>{
 for(const environment of [{},{ADT_TOOL_OPERATORS:'reviewer'},{ADT_TOOL_POLICY_ADMINS:'reviewer'}])assert.equal(hasToolRole('reviewer','approver',environment),false);
 const f=await fixture(t);await f.step();await f.step();const{approval}=await f.approval();const journal=new AgentJournal(f.db,f.journal.now,{});await assert.rejects(journal.decide(action(f,approval)),/permission_denied/);assert.equal((await f.approval()).approval.status,'pending');
});

test('a per-tool reviewer cannot elevate a repository user who has not been delegated approval authority',async t=>{
 const f=await fixture(t,{policy:{reviewers:['other']}});await f.step();await f.step();const{approval}=await f.approval();await assert.rejects(f.journal.decide(action(f,approval,'other')),/permission_denied/);await assert.rejects(f.journal.decide(action(f,approval)),/permission_denied/);
 f.environment.ADT_TOOL_APPROVERS='reviewer,other';await f.journal.decide(action(f,approval,'other'));assert.equal((await f.approval()).approval.decided_by,'other');
});

test('delegation is checked after a long suspension, and revocation prevents decisions and actionable inspection controls',async t=>{
 const f=await fixture(t);await f.step();await f.step();const{approval}=await f.approval();assert.equal((await f.journal.inspect(f.options.runId,false,'reviewer'))[0].approval.canDecide,true);
 f.advance(3600000);f.environment.ADT_TOOL_APPROVERS='';await assert.rejects(f.journal.decide(action(f,approval)),/permission_denied/);assert.equal((await f.journal.inspect(f.options.runId,false,'reviewer'))[0].approval.canDecide,false);assert.equal((await f.approval()).approval.status,'pending');assert.equal(f.executions,0);
});

test('revoking a previously accepted approver before admission stops external execution',async t=>{
 const f=await fixture(t);await f.step();await f.step();await f.decide('approved');f.environment.ADT_TOOL_APPROVERS='';await f.step();const{call}=await f.approval();assert.equal(call.state,'denied');assert.equal(JSON.parse(call.result_json).code,'approver_authority_revoked');assert.equal(f.executions,0);
});

test('delegated decisions remain idempotent, expiry remains authoritative, and rejection continues the model',async t=>{
 const f=await fixture(t,{policy:{expirySeconds:60}});await f.step();await f.step();const{approval}=await f.approval(),decision=action(f,approval);assert.equal(await f.journal.decide(decision),true);assert.equal(await f.journal.decide(decision),false);f.advance(60000);await f.step();assert.equal(f.executions,0);assert.equal((await f.approval()).call.state,'denied');
 const g=await fixture(t);await g.step();await g.step();await g.decide('rejected');await g.step();await g.step();await g.step();assert.equal((await g.step()).outputText,'finished');assert.equal(g.executions,0);
});

for(const change of ['reviewers','deny','git_tamper'])test(`decision-time live policy authority rejects a pending approval after ${change}`,async t=>{
 const f=await fixture(t),m=await policyFixture(t);m.authority=new D1McpPolicyAuthority(f.db);const context={authority:m.authority,actor:'admin',environment:{ADT_TOOL_POLICY_ADMINS:'admin'}};
 const input={id:'docs',name:'Docs',endpointUrl:'https://tools.example/mcp',authenticationMode:'none'},schema=f.tool.schema;
 let saved=await createMcpServer(101,input,m.repo,m.vault,context);saved=await discoverMcpServer(101,'docs',saved.fileSha,m.repo,m.vault,{discoverMcp:async()=>[{name:'search',inputSchema:schema}]},context);saved=await updateMcpServer(101,{...input,fileSha:saved.fileSha,toolPolicies:{search:{reviewers:['reviewer']}}},m.repo,m.vault,context);
 const agent={...f.options.agent,tools:[{type:'mcp',serverId:'docs',toolName:'search'}]},frozen=(await freezeAuthorizedMcpTools(101,[agent],m.repo,m.vault,m.authority))[agent.id][0];frozen.alias='change';f.tool.frozen=frozen;f.tool.key='mcp:docs:search';f.tool.policy=frozen.policy;
 await f.step();await f.step();const{call}=await f.approval();
 if(change==='git_tamper')await m.repo.update({...saved.definition,toolPolicies:{}},saved.fileSha);
 else await updateMcpServer(101,{...input,fileSha:saved.fileSha,toolPolicies:{search:change==='deny'?{minimum:'deny'}:{reviewers:['other']}}},m.repo,m.vault,context);
 await assert.rejects(toolApprovalAuthority({journal:f.journal,runId:f.options.runId,invocationId:call.id,actor:'reviewer',repositoryId:101,repository:m.repo,policies:m.authority,vault:m.vault}));assert.equal((await f.approval()).approval.status,'pending');assert.equal(f.executions,0);
});

for(const race of [false,true])test(`a valid MCP decision pins its live policy head (${race?'concurrent change is rejected':'authorized approval succeeds'})`,async t=>{
 const f=await fixture(t),m=await policyFixture(t);m.authority=new D1McpPolicyAuthority(f.db);const context={authority:m.authority,actor:'admin',environment:{ADT_TOOL_POLICY_ADMINS:'admin'}},input={id:'docs',name:'Docs',endpointUrl:'https://tools.example/mcp',authenticationMode:'none'};
 const created=await createMcpServer(101,input,m.repo,m.vault,context);await discoverMcpServer(101,'docs',created.fileSha,m.repo,m.vault,{discoverMcp:async()=>[{name:'search',inputSchema:f.tool.schema}]},context);
 const agent={...f.options.agent,tools:[{type:'mcp',serverId:'docs',toolName:'search'}]},frozen=(await freezeAuthorizedMcpTools(101,[agent],m.repo,m.vault,m.authority))[agent.id][0];frozen.alias='change';f.tool.frozen=frozen;f.tool.key='mcp:docs:search';await f.step();await f.step();const{call,approval}=await f.approval();
 const policyAuthority=await toolApprovalAuthority({journal:f.journal,runId:f.options.runId,invocationId:call.id,actor:'reviewer',repositoryId:101,repository:m.repo,policies:m.authority,vault:m.vault});
 if(race){await m.authority.begin(101,'docs',await m.authority.head(101,'docs'));await assert.rejects(f.journal.decide({...action(f,approval),policyAuthority}),/approval_not_pending/);assert.equal((await f.approval()).approval.status,'pending')}
 else{const decision={...action(f,approval),policyAuthority};assert.equal(await f.journal.decide(decision),true);assert.equal(await f.journal.decide(decision),false)}
});
