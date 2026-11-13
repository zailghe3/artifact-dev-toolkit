import test from 'node:test';
import assert from 'node:assert/strict';
import {policyFixture} from './helpers/mcp-policy-fixture.mjs';
import {createMcpServer,updateMcpServer,deleteMcpServer,discoverMcpServer} from '../lib/mcp-tool-service.ts';
import {freezeAuthorizedMcpTools,resolveFrozenMcpTools} from '../lib/mcp-tool-authority.ts';
import {approvalPolicySchema,evaluateToolPolicy} from '../adt-runtime/src/agent-contract.ts';
const repositoryId=101,input={id:'docs',name:'Docs',endpointUrl:'https://tools.example/mcp',authenticationMode:'none'};
const schema={type:'object',properties:{repo:{type:'string'}},required:['repo'],additionalProperties:false};
const agent={id:'agent',tools:[{type:'mcp',serverId:'docs',toolName:'search'}]};
async function setup(t,policy){const f=await policyFixture(t);let saved=await createMcpServer(repositoryId,input,f.repo,f.vault,f.context('member'));saved=await discoverMcpServer(repositoryId,'docs',saved.fileSha,f.repo,f.vault,{discoverMcp:async()=>[{name:'search',inputSchema:schema}]},f.context('member'));if(policy)saved=await updateMcpServer(repositoryId,{...input,fileSha:saved.fileSha,toolPolicies:{search:policy}},f.repo,f.vault,f.context());return Object.assign(f,{saved,freeze:()=>freezeAuthorizedMcpTools(repositoryId,[agent],f.repo,f.vault,f.authority),resolve:snapshot=>resolveFrozenMcpTools(repositoryId,agent,snapshot,f.vault,{repository:f.repo,policies:f.authority})})}
const p=value=>approvalPolicySchema.parse(value);

for(const policy of [{minimum:'deny'},{classification:'read_only'}])test(`non-admin cannot indirectly clear ${JSON.stringify(policy)} or mutate credentials/Git`,async t=>{
 const f=await setup(t,policy),before=structuredClone(f.saved),proof=await f.authority.head(repositoryId,'docs');
 for(const change of [{endpointUrl:'https://replacement.example/mcp'},{authenticationMode:'bearer',bearerToken:'replacement-secret'},{toolPolicies:{}},{toolPolicies:{search:p({minimum:'automatic',classification:'mutating'})}}]){
  await assert.rejects(updateMcpServer(repositoryId,{...input,fileSha:f.saved.fileSha,...change},f.repo,f.vault,f.context('member')),/permission_denied/);
  assert.deepEqual(await f.repo.get('docs'),before);assert.deepEqual(await f.authority.head(repositoryId,'docs'),proof);assert.equal(f.vault.values.size,0);
 }
 await assert.rejects(deleteMcpServer(repositoryId,'docs',f.saved.fileSha,f.repo,f.vault,f.context('member')),/permission_denied/);
 const renamed=await updateMcpServer(repositoryId,{...input,name:'Renamed',fileSha:f.saved.fileSha},f.repo,f.vault,f.context('member'));assert.equal(renamed.definition.name,'Renamed');assert.deepEqual(renamed.definition.toolPolicies,before.definition.toolPolicies);assert.equal((await f.authority.verify(repositoryId,renamed.definition,f.vault)).guard.authorityId,proof.authority_id);
});

for(const change of ['drop_deny','read_only','automatic_mutation','reviewers','endpoint','schema','authentication'])test(`untrusted direct Git edit fails at freezing and live resolution: ${change}`,async t=>{
 const f=await setup(t,{minimum:'deny',reviewers:['reviewer']}),snapshot=await f.freeze(),definition=structuredClone(f.saved.definition);
 if(change==='drop_deny')delete definition.toolPolicies;
 if(change==='read_only')definition.toolPolicies={search:p({classification:'read_only'})};
 if(change==='automatic_mutation')definition.toolPolicies={search:p({classification:'mutating',minimum:'automatic'})};
 if(change==='reviewers')definition.toolPolicies.search.reviewers=['attacker'];
 if(change==='endpoint')definition.endpointUrl='https://replacement.example/mcp';
 if(change==='schema')definition.catalogue.tools[0].inputSchema={type:'object'};
 if(change==='authentication')definition.authentication={mode:'bearer',credentialSecretRef:`sec_${'a'.repeat(43)}`};
 await f.repo.update(definition,f.saved.fileSha);await assert.rejects(f.freeze());await assert.rejects(f.resolve(snapshot));
 await assert.rejects(updateMcpServer(repositoryId,{...input,fileSha:(await f.repo.get('docs')).fileSha},f.repo,f.vault,f.context('member')),/mcp_policy_unverified/);
});

test('missing attestation is never treated as a default policy or accepted as administrator proof',async t=>{
 const f=await policyFixture(t);await f.repo.create({schemaVersion:1,id:'docs',name:'Direct Git',type:'mcp',transport:'streamable-http',endpointUrl:input.endpointUrl,authentication:{mode:'none'},catalogue:{tools:[{name:'search',inputSchema:schema}],refreshedAt:new Date().toISOString()},toolPolicies:{search:p({classification:'read_only'})}});
 await assert.rejects(freezeAuthorizedMcpTools(repositoryId,[agent],f.repo,f.vault,f.authority),/mcp_policy_unverified/);
});

test('administrator application edits attest exact policies and frozen policy cannot be weakened by later authorised changes',async t=>{
 const f=await setup(t,{minimum:'approval'}),frozen=await f.freeze();assert.ok(frozen.agent[0].policyAuthorityId);
 const saved=await updateMcpServer(repositoryId,{...input,fileSha:f.saved.fileSha,toolPolicies:{search:p({classification:'mutating',minimum:'automatic',automaticWhen:[{path:['repo'],equals:'safe'}]})}},f.repo,f.vault,f.context());
 const live=(await f.resolve(frozen))[0];assert.equal(evaluateToolPolicy([frozen.agent[0].policy,live.livePolicy],{repo:'safe'}),'approval');
 const next=await f.freeze();assert.equal(evaluateToolPolicy([next.agent[0].policy],{repo:'safe'}),'automatic');assert.equal(evaluateToolPolicy([next.agent[0].policy],{repo:'other'}),'approval');
 assert.notEqual(next.agent[0].policyAuthorityId,frozen.agent[0].policyAuthorityId);assert.equal((await f.repo.get('docs')).fileSha,saved.fileSha);
});

test('proofs cannot be transplanted between repositories or used to substitute a frozen policy',async t=>{
 const f=await setup(t),snapshot=await f.freeze(),forged=structuredClone(snapshot);forged.agent[0].policy=p({classification:'read_only'});
 await assert.rejects(f.resolve(forged),/mcp_policy_unverified/);const historical=structuredClone(snapshot);delete historical.agent[0].policyAuthorityId;await assert.rejects(f.resolve(historical),/mcp_policy_unverified/);
 await assert.rejects(resolveFrozenMcpTools(202,agent,snapshot,f.vault,{repository:f.repo,policies:f.authority}),/mcp_policy_unverified/);
});

test('discovery cannot replace the schema of a trusted tool without explicit administrator policy review',async t=>{
 const f=await setup(t,{classification:'read_only'});
 await assert.rejects(discoverMcpServer(repositoryId,'docs',f.saved.fileSha,f.repo,f.vault,{discoverMcp:async()=>[{name:'search',inputSchema:{type:'object'}}]},f.context('member')),/mcp_policy_tool_unavailable/);
 assert.deepEqual(await f.repo.get('docs'),f.saved);assert.ok(await f.freeze());
});

test('Git races during an administrator save cannot attest a different policy than the one reviewed',async t=>{
 const f=await setup(t,{minimum:'deny'}),update=f.repo.update.bind(f.repo);f.repo.update=async(value,sha)=>{const expected=await update(value,sha);await update({...value,toolPolicies:{search:p({classification:'read_only'})}},expected.fileSha);return expected};
 await assert.rejects(updateMcpServer(repositoryId,{...input,name:'Admin rename',fileSha:f.saved.fileSha},f.repo,f.vault,f.context()),/mcp_policy_conflict/);
 assert.equal((await f.authority.head(repositoryId,'docs')).state,'blocked');await assert.rejects(f.freeze(),/mcp_policy_unverified/);
});

test('interrupted publication remains blocked; non-admin cannot recover it; explicit administrator reauthorization can',async t=>{
 const f=await setup(t,{minimum:'deny'}),publish=f.authority.publish.bind(f.authority);f.authority.publish=async()=>{throw Error('database unavailable')};
 await assert.rejects(updateMcpServer(repositoryId,{...input,name:'Changed',fileSha:f.saved.fileSha},f.repo,f.vault,f.context('member')));
 assert.equal((await f.authority.head(repositoryId,'docs')).state,'blocked');await assert.rejects(f.freeze());f.authority.publish=publish;
 const saved=await f.repo.get('docs');await assert.rejects(updateMcpServer(repositoryId,{...input,name:'Changed',fileSha:saved.fileSha},f.repo,f.vault,f.context('member')),/mcp_policy_unverified/);
 await updateMcpServer(repositoryId,{...input,name:'Changed',fileSha:saved.fileSha,toolPolicies:saved.definition.toolPolicies},f.repo,f.vault,f.context());assert.ok(await f.freeze());
});

test('an authority mutation starting after verification prevents admission using the stale guard',async t=>{
 const {fixture}=await import('./helpers/agent-tool-fixture.mjs'),run=await fixture(t),f=await setup(t,{classification:'read_only'});
 // Use the same D1 as the Agent journal for the actual admission predicate.
 const {D1McpPolicyAuthority}=await import('../lib/mcp-policy-authority.ts'),authority=new D1McpPolicyAuthority(run.db),context={authority,actor:'admin',environment:{ADT_TOOL_POLICY_ADMINS:'admin'}},token=await authority.begin(repositoryId,'docs',undefined);await authority.publish(repositoryId,f.saved.definition,f.vault,context,token);
 const verified=await authority.verify(repositoryId,f.saved.definition,f.vault);run.tool.policy=p({classification:"read_only"});run.options.admissionAuthority=()=>verified.guard;run.options.authorize=async()=>{await authority.begin(repositoryId,'docs',await authority.head(repositoryId,'docs'));return[]};
 await run.step();await run.step();assert.equal(run.executions,0);assert.equal((await run.journal.calls(run.options.id))[0].state,'eligible');assert.equal((await run.journal.get(run.options.id)).tool_executions,0);
});

for(const classification of ['read_only','mutating'])test(`automaticWhen is mandatory for ${classification} and cannot override stricter controls`,()=>{
 const conditional=p({classification,minimum:'automatic',automaticWhen:[{path:['repo'],equals:'safe'}]});assert.equal(evaluateToolPolicy([conditional],{repo:'safe'}),'automatic');assert.equal(evaluateToolPolicy([conditional],{repo:'other'}),'approval');assert.equal(evaluateToolPolicy([conditional],{repo:'safe'},true),'approval');assert.equal(evaluateToolPolicy([conditional,p({minimum:'approval'})],{repo:'safe'}),'approval');assert.equal(evaluateToolPolicy([conditional,p({minimum:'deny'})],{repo:'other'}),'deny');assert.equal(evaluateToolPolicy([p({...conditional,resource:{path:['repo'],allowed:['safe']}})],{repo:'other'}),'deny');
});

test('trusted policies bind credential identity; ordinary replacement is rejected and administrator replacement revokes the prior proof',async t=>{
 const f=await setup(t,{classification:'read_only'}),policy=f.saved.definition.toolPolicies;
 let saved=await updateMcpServer(repositoryId,{...input,authenticationMode:'bearer',bearerToken:'first-token',fileSha:f.saved.fileSha,toolPolicies:policy},f.repo,f.vault,f.context());const frozen=await f.freeze(),before=f.vault.values.size;
 await assert.rejects(updateMcpServer(repositoryId,{...input,authenticationMode:'bearer',bearerToken:'unapproved-token',fileSha:saved.fileSha},f.repo,f.vault,f.context('member')),/permission_denied/);assert.equal(f.vault.values.size,before);
 saved=await updateMcpServer(repositoryId,{...input,authenticationMode:'bearer',bearerToken:'second-token',fileSha:saved.fileSha,toolPolicies:policy},f.repo,f.vault,f.context());await assert.rejects(f.resolve(frozen),/mcp_policy_unverified/);assert.equal((await f.resolve(await f.freeze()))[0].credential,'second-token');assert.doesNotMatch(JSON.stringify(await f.freeze()),/first-token|second-token|sec_/);
});

test('read-only automaticWhen also constrains its risk-based default without an explicit automatic minimum',()=>{
 const policy=p({classification:'read_only',automaticWhen:[{path:['repo'],equals:'safe'}]});assert.equal(evaluateToolPolicy([policy],{repo:'safe'}),'automatic');assert.equal(evaluateToolPolicy([policy],{repo:'other'}),'approval');assert.equal(evaluateToolPolicy([p({classification:'mutating',automaticWhen:policy.automaticWhen})],{repo:'safe'}),'approval');
});

test('a transient Git edit restored before the write cannot supply an unreviewed schema to an administrator metadata save',async t=>{
 const f=await setup(t,{classification:'read_only'}),original=structuredClone(f.saved),head=await f.authority.head(repositoryId,'docs'),get=f.repo.get.bind(f.repo);let reads=0;
 // Model a response captured during an external edit: Git is restored to its old
 // content SHA before the update RPC, so checking only the write SHA is insufficient.
 f.repo.get=async id=>{const value=await get(id);if(++reads===2)return{...value,fileSha:'transient-git-content-sha',definition:{...value.definition,catalogue:{...value.definition.catalogue,tools:[{name:'search',inputSchema:{type:'object',additionalProperties:true}}]}}};return value};
 await assert.rejects(updateMcpServer(repositoryId,{...input,name:'Administrator rename',fileSha:original.fileSha},f.repo,f.vault,f.context()),/definition_conflict/);
 assert.deepEqual(await get('docs'),original);const current=await f.authority.head(repositoryId,'docs');assert.equal(current.state,'ready');assert.equal(current.authority_id,head.authority_id);assert.ok(await f.freeze());
});
