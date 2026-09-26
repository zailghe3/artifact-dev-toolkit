import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveWorkflowRunConnectionSnapshot} from '../lib/workflow-run-connection-snapshots.ts';
import {safeConnectionSnapshot} from '../lib/workflow-connections.ts';
import {validateWorkflowReferences,agentDefinitionSchema} from '../lib/workflow-definitions.ts';
import {GitAuthoritativeWorkflowProviderConnectionStore} from '../lib/git-workflow-provider-connection-store.ts';
import {serializeWorkIqPrivateBundle} from '../lib/work-iq-auth.ts';

const capabilities={asynchronous:true,cancellation:true};
const descriptor=(key,adapter,extra={})=>({key,name:key,adapter,enabled:true,capabilities,...extra});

test('Codex Runner snapshot persists only safe metadata without provider resolution',async()=>{
 let calls=0;const connection=descriptor('codex-primary','codex-runner',{serverConfiguration:{baseUrl:'private'},privateOptions:{secret:'runner-secret'}});
 const snapshot=await resolveWorkflowRunConnectionSnapshot(connection,{resolveForSnapshot:async()=>{calls++;throw new Error('must not resolve')}});
 assert.equal(calls,0);assert.deepEqual(snapshot,descriptor('codex-primary','codex-runner'));assert.doesNotMatch(JSON.stringify(snapshot),/private|secret|serverConfiguration|privateOptions/);
});

test('OpenAI Responses snapshot verifies the stored credential but never persists it',async()=>{
 let calls=0;const connection=descriptor('openai-primary','openai-responses',{defaultModel:'gpt-safe'}),credential='provider-secret';
 const snapshot=await resolveWorkflowRunConnectionSnapshot(connection,{resolveForSnapshot:async key=>{calls++;assert.equal(key,'openai-primary');return{...connection,credential,privateOptions:{hidden:true}}}});
 assert.equal(calls,1);assert.deepEqual(snapshot,connection);assert.doesNotMatch(JSON.stringify(snapshot),new RegExp(`${credential}|credential|privateOptions|hidden`));
});

test('mixed GPT then Codex run snapshots resolve successfully across both trust boundaries',async()=>{
 let calls=0;const openai=descriptor('openai-primary','openai-responses',{defaultModel:'gpt-safe'}),codex=descriptor('codex-primary','codex-runner',{serverConfiguration:{sharedSecret:'runner-secret'}}),store={resolveForSnapshot:async key=>{calls++;assert.equal(key,openai.key);return{...openai,credential:'openai-secret'}}};
 const snapshots=await Promise.all([openai,codex].map(connection=>resolveWorkflowRunConnectionSnapshot(connection,store)));
 assert.equal(calls,1);assert.deepEqual(snapshots,[openai,descriptor('codex-primary','codex-runner')]);assert.doesNotMatch(JSON.stringify(snapshots),/openai-secret|runner-secret|credential|serverConfiguration/);
});

test('deterministic test connection retains its safe built-in snapshot',async()=>{
 let calls=0;const connection=descriptor('deterministic-test','deterministic-test');assert.deepEqual(await resolveWorkflowRunConnectionSnapshot(connection,{resolveForSnapshot:async()=>{calls++}}),connection);assert.equal(calls,0);
});

test('unsupported and unavailable connections fail closed',async()=>{
 const store={resolveForSnapshot:async()=>{throw new Error('must not resolve')}};await assert.rejects(resolveWorkflowRunConnectionSnapshot(descriptor('other','unknown'),store),/connection_unavailable/);await assert.rejects(resolveWorkflowRunConnectionSnapshot({...descriptor('codex-primary','codex-runner'),enabled:false},store),/connection_unavailable/);
});

test('Workflow validation still rejects an unavailable Codex Runner before snapshot construction',async()=>{
 const gpt=agentDefinitionSchema.parse({schemaVersion:2,id:'gpt',name:'GPT',description:'',status:'draft',prompt:{source:'custom',text:'First.'},connectionKey:'openai-primary'}),codex=agentDefinitionSchema.parse({schemaVersion:2,id:'codex',name:'Codex',description:'',status:'draft',prompt:{source:'custom',text:'Second.'},connectionKey:'codex-primary',adapterOptions:{environmentKey:'ready'}}),workflow={schemaVersion:2,id:'mixed',name:'Mixed',description:'',status:'draft',nodes:[{id:'gpt-node',blockType:'agent',blockVersion:1,config:{agentId:'gpt'}},{id:'codex-node',blockType:'agent',blockVersion:1,config:{agentId:'codex'}}],edges:[{id:'handoff',source:'gpt-node',target:'codex-node'}],limits:{maxStepExecutions:2}};
 await assert.rejects(validateWorkflowReferences(workflow,[gpt,codex],new Set(['openai-primary'])),/connection_unavailable/);
});

test('safe provider execution configuration survives snapshots without credentials',()=>{const connection=descriptor('synthetic','synthetic-provider',{providerConfiguration:{tenantId:'tenant-1',clientId:'client-1'},credential:'secret',privateOptions:{accessToken:'secret'}}),snapshot=safeConnectionSnapshot(connection);assert.deepEqual(snapshot.providerConfiguration,{tenantId:'tenant-1',clientId:'client-1'});assert.doesNotMatch(JSON.stringify(snapshot),/accessToken|secret/)});

test('Anthropic snapshot freezes only safe Workspace ID configuration',()=>{const connection=descriptor('anthropic','anthropic-messages',{providerConfiguration:{workspaceId:'wrkspc_team'},credential:'api-secret',credentialSource:'adt-vault',credentialSecretRef:'sec_ref'}),snapshot=safeConnectionSnapshot(connection);assert.deepEqual(snapshot.providerConfiguration,{workspaceId:'wrkspc_team'});assert.equal(snapshot.credentialSecretRef,'sec_ref');assert.doesNotMatch(JSON.stringify(snapshot),/api-secret|Authorization/)})

test('Work IQ snapshot readiness is local, immutable, and freezes its authorization context',async()=>{const context='ctx_abcdefghijklmnopqrstuvwxyzABCDEFG1234567890_-',secretRef=`sec_${'a'.repeat(43)}`,definition={schemaVersion:1,id:'work',name:'Work',runtime:'work-iq-rest',provider:'microsoft-work-iq',configuration:{tenantId:'11111111-1111-4111-8111-111111111111',clientId:'22222222-2222-4222-8222-222222222222'},credential:{source:'adt-vault',secretRef}},git={listConnections:async()=>[],getConnection:async()=>({definition,fileSha:'git-sha'})};let reads=0,writes=0,http=0;const priorFetch=globalThis.fetch;globalThis.fetch=async()=>{http++;throw new Error('must not fetch')};try{const vault={resolve:async()=>{throw new Error('unused')},resolveWithRevision:async()=>{reads++;return{value:serializeWorkIqPrivateBundle({version:1,kind:'work-iq-rest',clientSecret:'secret',refreshToken:'refresh',authorizationContextId:context}),revision:1}},replaceIfRevision:async()=>{writes++;return true}},store=new GitAuthoritativeWorkflowProviderConnectionStore(git,async()=>{},vault),connection={...descriptor('work','work-iq-rest',{management:'git',credentialSource:'adt-vault',credentialSecretRef:secretRef,repositoryRevision:'git-sha',providerConfiguration:definition.configuration,authorizationContextId:context}),capabilities:{asynchronous:false,cancellation:false}},snapshot=await resolveWorkflowRunConnectionSnapshot(connection,store);assert.equal(snapshot.authorizationContextId,context);assert.deepEqual({reads,writes,http},{reads:1,writes:0,http:0});assert.doesNotMatch(JSON.stringify(snapshot),/refresh|clientSecret|accessToken/)}finally{globalThis.fetch=priorFetch}});
