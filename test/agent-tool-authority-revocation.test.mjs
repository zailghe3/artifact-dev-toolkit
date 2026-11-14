import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/agent-tool-fixture.mjs';
import {AgentJournal} from '../lib/agent-journal.ts';
import {policyFixture} from './helpers/mcp-policy-fixture.mjs';
import {D1McpPolicyAuthority} from '../lib/mcp-policy-authority.ts';
import {toolApprovalAuthority} from '../lib/agent-tool-approval-authority.ts';
import {createMcpServer,discoverMcpServer,updateMcpServer} from '../lib/mcp-tool-service.ts';
import {freezeAuthorizedMcpTools,resolveFrozenMcpTools,frozenMcpRunToolsSchema} from '../lib/mcp-tool-authority.ts';

async function setup(t,bearer=false){
 const f=await fixture(t),m=await policyFixture(t);m.authority=new D1McpPolicyAuthority(f.db);
 const context={authority:m.authority,actor:'member',environment:m.environment},input={id:'docs',name:'Docs',endpointUrl:'https://tools.example/mcp',authenticationMode:bearer?'bearer':'none',...(bearer?{bearerToken:'credential-A'}:{})};
 let saved=await createMcpServer(101,input,m.repo,m.vault,context);saved=await discoverMcpServer(101,'docs',saved.fileSha,m.repo,m.vault,{discoverMcp:async()=>[{name:'search',inputSchema:f.tool.schema}]},context);
 const agent={...f.options.agent,tools:[{type:'mcp',serverId:'docs',toolName:'search'}]},freeze=()=>freezeAuthorizedMcpTools(101,[agent],m.repo,m.vault,m.authority),external=[],conversations=[];
 const install=snapshot=>{const frozen=snapshot[agent.id][0];frozen.alias='change';Object.assign(f.tool,{key:'mcp:docs:search',frozen});f.options.agent=agent;f.options.authorize=async()=>{const[tool]=await resolveFrozenMcpTools(101,agent,snapshot,m.vault,{repository:m.repo,policies:m.authority});f.guard=tool.authorityGuard;return[tool.livePolicy]};f.options.admissionAuthority=()=>f.guard;f.options.execute=async()=>{const[tool]=await resolveFrozenMcpTools(101,agent,snapshot,m.vault,{repository:m.repo,policies:m.authority});external.push(tool.credential);return{changed:true}};f.options.progress=async request=>{if(request.turn===1)return{version:1,text:'',calls:[{id:'original',name:'change',arguments:{repo:'safe'}}]};conversations.push(request.conversation);return{version:1,text:'finished',calls:[]}};};
 const authority=(call,decision,actor='reviewer')=>toolApprovalAuthority({journal:f.journal,runId:f.options.runId,invocationId:call.id,decision,actor,repositoryId:101,repository:m.repo,policies:m.authority,vault:m.vault});
 const decide=async(call,approval,decision)=>{const policyAuthority=await authority(call,decision);const value={runId:f.options.runId,approvalId:approval.id,decisionId:crypto.randomUUID(),decision,actor:'reviewer',policyAuthority};await f.journal.decide(value);return value};
 return{f,m,input,context,get saved(){return saved},freeze,install,external,conversations,authority,decide};
}

for(const timing of ['pending','approved'])test(`policy-free credential replacement invalidates ${timing} frozen authority and requires a new approval`,async t=>{
 const s=await setup(t,true),{f,m}=s,old=await s.freeze();s.install(old);await f.step();await f.step();let{call,approval}=await f.approval();assert.equal(approval.status,'pending');if(timing==='approved')await s.decide(call,approval,'approved');
 await updateMcpServer(101,{...s.input,bearerToken:'credential-B',fileSha:s.saved.fileSha},m.repo,m.vault,s.context);
 assert.equal(m.vault.binding().id,old[f.options.agent.id][0].credentialBindingId);
 await assert.rejects(s.authority(call,'approved'),/mcp_policy_unverified/);
 await assert.rejects(resolveFrozenMcpTools(101,f.options.agent,old,m.vault,{repository:m.repo,policies:m.authority}),/mcp_policy_unverified/);
 if(timing==='pending')await s.decide(call,approval,'rejected');await f.step();assert.equal((await f.approval()).call.state,'denied');assert.deepEqual(s.external,[]);
 // A fresh invocation must independently pass approval and mandatory security.
 f.options.id=crypto.randomUUID();f.options.nodeId='new-agent';f.options.activationId=crypto.randomUUID();const fresh=await s.freeze();s.install(fresh);await f.step();await f.step();({call,approval}=await f.approval());assert.equal(approval.status,'pending');assert.deepEqual(s.external,[]);await s.decide(call,approval,'approved');await f.step();assert.deepEqual(s.external,['credential-B']);assert.equal((await f.approval()).call.state,'completed');
});

test('credential rotation between policy verification and credential resolution cannot substitute a token',async t=>{
 const s=await setup(t,true),{f,m}=s,snapshot=await s.freeze(),resolve=m.vault.resolveMcpServerCredential.bind(m.vault);let called=0;
 m.vault.resolveMcpServerCredential=async(...args)=>{called++;await updateMcpServer(101,{...s.input,bearerToken:'credential-B',fileSha:s.saved.fileSha},m.repo,m.vault,s.context);return resolve(...args)};
 await assert.rejects(resolveFrozenMcpTools(101,{...f.options.agent,tools:[{type:'mcp',serverId:'docs',toolName:'search'}]},snapshot,m.vault,{repository:m.repo,policies:m.authority}),/vault_secret_unavailable/);assert.equal(called,1);assert.deepEqual(s.external,[]);
});

for(const change of ['revoked','unverified','missing'])test(`a ${change} live policy prevents approval but allows frozen-authorised rejection and correlated model continuation`,async t=>{
 const s=await setup(t),{f,m}=s;let saved=await updateMcpServer(101,{...s.input,fileSha:s.saved.fileSha,toolPolicies:{search:{reviewers:['reviewer']}}},m.repo,m.vault,{...s.context,actor:'admin'});const snapshot=await s.freeze();s.install(snapshot);f.tool.policy=snapshot[f.options.agent.id][0].policy;await f.step();await f.step();const{call,approval}=await f.approval();
 if(change==='revoked')await updateMcpServer(101,{...s.input,fileSha:saved.fileSha,toolPolicies:{search:{minimum:'deny',reviewers:['other']}}},m.repo,m.vault,{...s.context,actor:'admin'});
 else if(change==='unverified')await m.repo.update({...saved.definition,toolPolicies:{}},saved.fileSha);
 else await m.repo.delete('docs',saved.fileSha);
 await assert.rejects(s.authority(call,'approved'));assert.equal((await f.approval()).approval.status,'pending');await assert.rejects(s.authority(call,'rejected','other'),/permission_denied/);
 const decision=await s.decide(call,approval,'rejected');assert.equal(await f.journal.decide(decision),false);await assert.rejects(f.journal.decide({...decision,decisionId:crypto.randomUUID(),decision:'approved'}),/approval_not_pending/);
 f.options.journal=new AgentJournal(f.db,f.journal.now,f.environment);await f.step();await f.step();await f.step();assert.equal((await f.step()).outputText,'finished');assert.equal((await f.approval()).approval.status,'rejected');assert.equal((await f.approval()).call.state,'denied');assert.deepEqual(s.external,[]);const result=s.conversations[0].at(-1);assert.equal(result.role,'tool');assert.equal(result.callId,'original');assert.equal(result.denied,true);assert.equal(JSON.parse(result.text).code,'human_rejected');
});


test('historical bearer snapshots remain readable but an attestation without credential identity cannot execute',async t=>{
 const s=await setup(t,true),{m}=s,snapshot=await s.freeze(),item=snapshot[s.f.options.agent.id][0],verified=await m.authority.verify(101,s.saved.definition,m.vault),record=await m.authority.attestation(item.policyAuthorityId),scope=JSON.parse(record.scope_json);delete scope.credentialDigest;
 await m.authority.db.prepare('UPDATE mcp_policy_attestations SET scope_json=? WHERE id=?').bind(JSON.stringify(scope),item.policyAuthorityId).run();assert.deepEqual(frozenMcpRunToolsSchema.parse(snapshot),snapshot);await assert.rejects(m.authority.verifyFrozen(101,item,verified),/mcp_policy_unverified/);
});
