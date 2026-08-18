import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveWorkflowRunConnectionSnapshot} from '../lib/workflow-run-connection-snapshots.ts';
import {validateWorkflowReferences,buildSequentialWorkflow,agentDefinitionSchema} from '../lib/workflow-definitions.ts';

const capabilities={asynchronous:true,cancellation:true};
const descriptor=(key,adapter,extra={})=>({key,name:key,adapter,enabled:true,capabilities,...extra});

test('Codex Runner snapshot persists only safe metadata without provider resolution',async()=>{
 let calls=0;const connection=descriptor('codex-primary','codex-runner',{serverConfiguration:{baseUrl:'private'},privateOptions:{secret:'runner-secret'}});
 const snapshot=await resolveWorkflowRunConnectionSnapshot(connection,{resolveCredential:async()=>{calls++;throw new Error('must not resolve')}});
 assert.equal(calls,0);assert.deepEqual(snapshot,descriptor('codex-primary','codex-runner'));assert.doesNotMatch(JSON.stringify(snapshot),/private|secret|serverConfiguration|privateOptions/);
});

test('OpenAI Responses snapshot verifies the stored credential but never persists it',async()=>{
 let calls=0;const connection=descriptor('openai-primary','openai-responses',{defaultModel:'gpt-safe'}),credential='provider-secret';
 const snapshot=await resolveWorkflowRunConnectionSnapshot(connection,{resolveCredential:async key=>{calls++;assert.equal(key,'openai-primary');return{...connection,credential,privateOptions:{hidden:true}}}});
 assert.equal(calls,1);assert.deepEqual(snapshot,connection);assert.doesNotMatch(JSON.stringify(snapshot),new RegExp(`${credential}|credential|privateOptions|hidden`));
});

test('mixed GPT then Codex run snapshots resolve successfully across both trust boundaries',async()=>{
 let calls=0;const openai=descriptor('openai-primary','openai-responses',{defaultModel:'gpt-safe'}),codex=descriptor('codex-primary','codex-runner',{serverConfiguration:{sharedSecret:'runner-secret'}}),store={resolveCredential:async key=>{calls++;assert.equal(key,openai.key);return{...openai,credential:'openai-secret'}}};
 const snapshots=await Promise.all([openai,codex].map(connection=>resolveWorkflowRunConnectionSnapshot(connection,store)));
 assert.equal(calls,1);assert.deepEqual(snapshots,[openai,descriptor('codex-primary','codex-runner')]);assert.doesNotMatch(JSON.stringify(snapshots),/openai-secret|runner-secret|credential|serverConfiguration/);
});

test('deterministic test connection retains its safe built-in snapshot',async()=>{
 let calls=0;const connection=descriptor('deterministic-test','deterministic-test');assert.deepEqual(await resolveWorkflowRunConnectionSnapshot(connection,{resolveCredential:async()=>{calls++}}),connection);assert.equal(calls,0);
});

test('unsupported and unavailable connections fail closed',async()=>{
 const store={resolveCredential:async()=>{throw new Error('must not resolve')}};await assert.rejects(resolveWorkflowRunConnectionSnapshot(descriptor('other','unknown'),store),/connection_unavailable/);await assert.rejects(resolveWorkflowRunConnectionSnapshot({...descriptor('codex-primary','codex-runner'),enabled:false},store),/connection_unavailable/);
});

test('Workflow validation still rejects an unavailable Codex Runner before snapshot construction',async()=>{
 const gpt=agentDefinitionSchema.parse({schemaVersion:1,id:'gpt',name:'GPT',description:'',status:'draft',masterPrompt:'First.',connectionKey:'openai-primary'}),codex=agentDefinitionSchema.parse({schemaVersion:1,id:'codex',name:'Codex',description:'',status:'draft',masterPrompt:'Second.',connectionKey:'codex-primary',adapterOptions:{environmentKey:'ready'}}),workflow=buildSequentialWorkflow({id:'mixed',name:'Mixed',agents:[gpt,codex]});
 await assert.rejects(validateWorkflowReferences(workflow,[gpt,codex],new Set(['openai-primary'])),/connection_unavailable/);
});
