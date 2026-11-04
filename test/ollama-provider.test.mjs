import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {installTsxHook} from './render-tsx.mjs';
import {getProviderConnectionType,providerRequiresCredential,assertProviderConfigurationMutable} from '../lib/provider-connection-types.ts';
import {connectionDefinitionSchema} from '../lib/workflow-connection-definitions.ts';
import {createApiKeyVaultConnection} from '../lib/provider-api-key-connection-creation.ts';
import {GitAuthoritativeWorkflowProviderConnectionStore,resolveApiKeySnapshotCredential} from '../lib/git-workflow-provider-connection-store.ts';
import {ProviderModelService} from '../lib/provider-model-service.ts';
import {listSavedProviderModels} from '../lib/provider-saved-model-discovery.ts';
import {mutateVaultCredential} from '../lib/provider-vault-connection-mutations.ts';
import {duplicateConnectionDraft} from '../lib/provider-connection-presentation.ts';
import {testWorkflowConnection} from '../lib/workflow-connection-test.ts';
import {validateAdapterOptions} from '../lib/workflow-adapter.ts';
import {providerExecutionTimeoutMs,PROVIDER_GRAPH_NODE_TIMEOUT_MS} from '../lib/provider-execution-timeouts.ts';
import {RemoteProviderRuntime,ADT_RUNTIME_PROTOCOL} from '../lib/adt-runtime-client.ts';
import {createAgentRuntimeRegistry,createWorkflowAdapterRegistry} from '../lib/agent-runtime.ts';

const configuration={baseUrl:'http://ollama:11434',authMode:'none'},secretRef=`sec_${'a'.repeat(43)}`,credential={source:'adt-vault',secretRef},policy=getProviderConnectionType('ollama-chat');
const definition=(authMode='none')=>({schemaVersion:1,id:'ollama',name:'Ollama',runtime:'ollama-chat',provider:'ollama',model:'model:tag',configuration:{...configuration,authMode},...(authMode==='bearer'?{credential}:{})});
const input=(authMode='none')=>({connectionKey:'ollama',displayName:'Ollama',adapter:'ollama-chat',model:'model:tag',configuration:{...configuration,authMode},...(authMode==='bearer'?{credential:'secret-sentinel'}:{})});
function fixture(authMode='none'){
 const calls=[],current={definition:connectionDefinitionSchema.parse(definition(authMode)),fileSha:'immutable'},repository={getConnection:async()=>current,listConnections:async()=>[current],createConnection:async value=>calls.push(['git',value])},vault={create:async value=>{calls.push(['create',value]);return secretRef},delete:async ref=>calls.push(['delete',ref]),resolve:async ref=>{calls.push(['resolve',ref]);return'secret-sentinel'},recover:async(ref,value)=>calls.push(['recover',ref,value]),replace:async(ref,value)=>calls.push(['replace',ref,value])},store=new GitAuthoritativeWorkflowProviderConnectionStore(repository,async()=>{throw Error('passive Ollama listing must not contact endpoint')},vault);
 return{calls,current,repository,vault,store};
}

test('Ollama policy requires a discoverable model, Runtime-only execution and its own tool-free settings',()=>{
 assert.equal(policy.execution,'adt-runtime');assert.equal(policy.authentication,'optional-api-key');assert.equal(policy.model.location,'adt-runtime');assert.equal(policy.model.required,true);assert.equal(policy.model.discovery,true);assert.equal(policy.capabilities.agentTools,false);assert.equal(policy.capabilities.runtimeSecurity,false);assert.equal(policy.agentSettings,'ollama-chat');
 assert.equal(providerRequiresCredential(policy,configuration),false);assert.equal(providerRequiresCredential(policy,{...configuration,authMode:'bearer'}),true);
 for(const invalid of [undefined,{}, {...configuration,authMode:'auto'},{...configuration,apiKey:'secret'}])assert.throws(()=>policy.safeConfiguration.parse(invalid));
});

test('only the explicit unauthenticated Ollama Git shape may omit a credential',()=>{
 assert.equal('credential' in connectionDefinitionSchema.parse(definition()),false);assert.deepEqual(connectionDefinitionSchema.parse(definition('bearer')).credential,credential);
 for(const value of [{...definition(),credential},{...definition('bearer'),credential:undefined}])assert.equal(connectionDefinitionSchema.safeParse(value).success,false);
 for(const runtime of ['openai-responses','openai-agents','anthropic-messages','work-iq-rest']){const existing=getProviderConnectionType(runtime),configuration=runtime==='work-iq-rest'?{tenantId:'11111111-1111-4111-8111-111111111111',clientId:'22222222-2222-4222-8222-222222222222'}:undefined;assert.equal(connectionDefinitionSchema.safeParse({schemaVersion:1,id:'existing',name:'Existing',runtime,provider:existing.provider,model:'model',configuration}).success,false)}
});

test('creation validates model before persistence, skips no-auth vault and cleans up definite bearer collision',async()=>{
 for(const authMode of ['none','bearer']){const f=fixture(authMode),lookup={getSafeDescriptor:async()=>undefined};let validated=false;
  const result=await createApiKeyVaultConnection(input(authMode),lookup,f.vault,f.repository,async(_key,model,safe)=>{assert.equal(f.calls.length,0);assert.equal(model,'model:tag');assert.deepEqual(safe,{...configuration,authMode});validated=true});assert.equal(validated,true);
  assert.deepEqual(f.calls.map(call=>call[0]),authMode==='none'?['git']:['create','git']);assert.equal(JSON.stringify(result).includes('secret-sentinel'),false);
  if(authMode==='none')assert.equal('credential' in result,false);
 }
 const f=fixture('bearer');f.repository.createConnection=async()=>{throw Error('connection_exists')};await assert.rejects(createApiKeyVaultConnection(input('bearer'),{getSafeDescriptor:async()=>undefined},f.vault,f.repository,async()=>{}),/connection_exists/);assert.deepEqual(f.calls.map(call=>call[0]),['create','delete']);
 const bad=fixture();await assert.rejects(createApiKeyVaultConnection({...input(),credential:'must-not-be-stored'},{getSafeDescriptor:async()=>undefined},bad.vault,bad.repository,async()=>{}));assert.deepEqual(bad.calls,[]);
 await assert.rejects(createApiKeyVaultConnection(input(),{getSafeDescriptor:async()=>undefined},bad.vault,bad.repository,async()=>{throw Error('model unavailable')}),/model unavailable/);assert.deepEqual(bad.calls,[]);
});

test('frozen none/bearer snapshots resolve exact credentials even if the live connection is edited or deleted',async()=>{
 for(const authMode of ['none','bearer']){const f=fixture(authMode),snapshot=await f.store.getSafeDescriptor('ollama');assert.equal(snapshot.enabled,true);assert.equal(snapshot.configured,true);assert.equal(f.calls.length,authMode==='bearer'?1:0);
  f.repository.getConnection=async()=>undefined;f.repository.listConnections=async()=>[];
  const resolved=await f.store.resolveForExecution('ollama',snapshot);assert.deepEqual(resolved.providerConfiguration,{...configuration,authMode});assert.equal(resolved.credential,authMode==='none'?undefined:'secret-sentinel');
  if(authMode==='bearer'){f.vault.resolve=async()=>{throw Error('revoked')};await assert.rejects(f.store.resolveForExecution('ollama',snapshot),/connection_unavailable/)}else for(const change of [{credentialSecretRef:secretRef},{credentialSource:'adt-vault'}])await assert.rejects(resolveApiKeySnapshotCredential('ollama',{...snapshot,...change},f.vault));
 }
});

test('saved commissioning rejects endpoint/auth retargeting before secret resolution and validates exact models',async()=>{
 const f=fixture('bearer'),models=new ProviderModelService({listRuntimeModels:async(safe,key)=>{assert.deepEqual(safe,definition('bearer').configuration);assert.equal(key,'secret-sentinel');return['model:tag','other']}});
 for(const configuration of [{baseUrl:'http://other',authMode:'bearer'},{...definition('bearer').configuration,authMode:'none'}]){await assert.rejects(listSavedProviderModels('ollama','ollama-chat',configuration,f.repository,f.store,models),/connection_configuration_immutable/);assert.deepEqual(f.calls,[]);assert.throws(()=>assertProviderConfigurationMutable(policy,definition('bearer').configuration,configuration),/immutable/)}
 assert.deepEqual(await listSavedProviderModels('ollama','ollama-chat',undefined,f.repository,f.store,models),['model:tag','other']);
 await models.validate('ollama-chat','secret-sentinel','other',definition('bearer').configuration);await assert.rejects(models.validate('ollama-chat','secret-sentinel','missing',definition('bearer').configuration),error=>error.category==='provider_rejected');
 assert.deepEqual(await testWorkflowConnection('ollama',f.store,new Map(),models),{ok:true,outputText:'Selected model is available through ADT Runtime.'});
});

test('credential management cannot apply to no-auth and duplication carries only safe configuration/model',async()=>{
 const f=fixture();await assert.rejects(mutateVaultCredential(f.current,'immutable',f.vault,'recover','key'),/credential_source_invalid/);assert.deepEqual(f.calls,[]);
 const bearer=fixture('bearer');await mutateVaultCredential(bearer.current,'immutable',bearer.vault,'replace','new-key');assert.deepEqual(bearer.calls,[['replace',secretRef,'new-key']]);
 const copy=duplicateConnectionDraft(await bearer.store.getSafeDescriptor('ollama'),new Set(['ollama']));assert.deepEqual(copy.providerConfiguration,definition('bearer').configuration);assert.equal(copy.model,'model:tag');assert.doesNotMatch(JSON.stringify(copy),/secretRef|credentialSource|secret-sentinel|repositoryRevision/);
});

test('Ollama options have strict defaults and fit the existing graph timeout/recovery ceiling',()=>{
 assert.deepEqual(validateAdapterOptions('ollama-chat',{}),{maxOutputTokens:4096,executionTimeoutSeconds:300});assert.equal(providerExecutionTimeoutMs('ollama-chat',{executionTimeoutSeconds:900}),900000);assert.ok(PROVIDER_GRAPH_NODE_TIMEOUT_MS>906000);
 for(const options of [{maxOutputTokens:0},{maxOutputTokens:32769},{executionTimeoutSeconds:4},{executionTimeoutSeconds:901},{reasoningEffort:'high'},{temperature:1}])assert.throws(()=>validateAdapterOptions('ollama-chat',options));
});

test('registry has no direct Ollama adapter and old Runtime can never activate a compatibility bridge',async()=>{
 assert.equal(createWorkflowAdapterRegistry().has('ollama-chat'),false);assert.ok(createAgentRuntimeRegistry().resolve('ollama-chat') instanceof RemoteProviderRuntime);
 const {generateKeyPairSync,createHash}=await import('node:crypto'),keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),keyId=createHash('sha256').update(Buffer.from(keys.publicKey.replace(/-----[^-]+-----|\s/g,''),'base64')).digest('base64url'),config={baseUrl:'https://runtime.example',authSecret:'s'.repeat(48),wrappingPublicKey:keys.publicKey},call={connection:{key:'ollama',name:'Ollama',adapter:'ollama-chat',enabled:true,defaultModel:'model:tag',providerConfiguration:configuration},idempotencyKey:'run:step:1:1',agentName:'Agent',masterPrompt:'prompt',inputText:''};
 for(const capabilities of [[],['openai-agents'],['provider-execution'],['provider-execution','provider-model-discovery']]){let bridge=0,requests=0;const runtime=new RemoteProviderRuntime(config,async()=>{requests++;return Response.json({protocolVersion:ADT_RUNTIME_PROTOCOL,capabilities,credentialWrappingKeyId:keyId})},'ollama-chat',{kind:'ollama-chat',start:async()=>{bridge++;throw Error('forbidden')}});await assert.rejects(runtime.start(call),error=>error.runtimeCode==='capability_unavailable');assert.equal(bridge,0);assert.equal(requests,1)}
});

test('Ollama connection and Agent editors show explicit auth and only supported controls',()=>{
 const require=installTsxHook(),{ProviderConnectionEditor}=require('../components/ProviderConnectionEditor.tsx'),{WorkflowAgentEditor}=require('../components/WorkflowAgentEditor.tsx');
 const {AppRouterContext}=require('next/dist/shared/lib/app-router-context.shared-runtime'),render=component=>renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:{back(){},forward(){},refresh(){},push(){},replace(){},prefetch(){}}},component));
 const initial={key:'ollama',name:'Ollama',runtime:'ollama-chat',model:'model:tag',repositoryRevision:'sha',configured:true,providerConfiguration:configuration},html=render(React.createElement(ProviderConnectionEditor,{initial}));
 assert.match(html,/Base URL/);assert.match(html,/Authentication/);assert.match(html,/readOnly/);assert.doesNotMatch(html,/id="credential-heading"/);
 const one={schemaVersion:2,id:'agent',name:'Agent',description:'',status:'draft',connectionKey:'ollama',prompt:{source:'custom',text:'Prompt'},adapterOptions:{}};
 const agentHtml=render(React.createElement(WorkflowAgentEditor,{initial:one,connections:[{key:'ollama',name:'Ollama',adapter:'ollama-chat',enabled:true,defaultModel:'model:tag',capabilities:policy.capabilities}]}));
 assert.match(agentHtml,/Maximum output tokens/);assert.match(agentHtml,/Execution timeout/);assert.doesNotMatch(agentHtml,/Reasoning effort|Verbosity|Artifact search|MCP tools|Time zone/);
});

test('an admitted long Ollama execution outlasts transport before recovery and is never blindly resubmitted',async()=>{
 const {InMemoryWorkflowRunStorage,newLangGraphWorkflowRun}=await import('../lib/workflow-storage.ts'),{agentDefinitionSchema,workflowDefinitionV2Schema,compileWorkflowV2ExecutionPlan}=await import('../lib/workflow-definitions.ts'),{graphStartUncertaintyMs,executeDurableGraphNodeTurn}=await import('../lib/workflow-durable-driver.ts'),{AgentRuntimeRegistry}=await import('../lib/agent-runtime.ts');
 let clock=Date.now(),starts=0;const connection={key:'ollama',name:'Ollama',adapter:'ollama-chat',enabled:true,defaultModel:'model:tag',management:'git',repositoryRevision:'sha',providerConfiguration:configuration,capabilities:policy.capabilities},agent=agentDefinitionSchema.parse({schemaVersion:2,id:'ollama-agent',name:'Ollama',description:'',status:'draft',connectionKey:'ollama',prompt:{source:'custom',text:'prompt'},adapterOptions:{executionTimeoutSeconds:900}}),workflow=workflowDefinitionV2Schema.parse({schemaVersion:2,id:'ollama-recovery',name:'Recovery',description:'',status:'draft',nodes:[{id:'node',blockType:'agent',blockVersion:1,config:{agentId:agent.id}}],edges:[],limits:{maxStepExecutions:1}}),run=newLangGraphWorkflowRun({id:crypto.randomUUID(),workflow,executionPlan:compileWorkflowV2ExecutionPlan(workflow,[agent]),agents:[agent],connections:[connection],revision:'sha',initialInput:''}),storage=new InMemoryWorkflowRunStorage(()=>new Date(clock));
 await storage.createRun(run);await storage.ensureGraphActivation(run.id,'node','activation');await storage.claimGraphNode(run.id,'node','','activation');const detail=await storage.getRun(run.id),wait=graphStartUncertaintyMs(detail,detail.attempts[0]);assert.ok(wait>906000);
 const turn=()=>executeDurableGraphNodeTurn({runId:run.id,nodeId:'node',activationId:'activation',inputText:'',storage,runtimes:new AgentRuntimeRegistry([{kind:'ollama-chat',start:async()=>{starts++;throw Error('must not resubmit')}}]),resolveConnection:async()=>connection,now:()=>clock});
 clock+=906001;assert.equal((await turn()).state,'pending');clock=Date.parse(detail.attempts[0].startedAt)+wait+1;assert.equal((await turn()).state,'failed');const terminal=await storage.getRun(run.id);assert.equal(terminal.attempts[0].failureCategory,'provider_start_ambiguous');assert.equal(terminal.attempts[0].retryable,false);assert.equal(starts,0);
});

test('saved Ollama discovery resolves the same saved credential identity even if current Git changes during the call',async()=>{
 const current={definition:definition('bearer'),fileSha:'frozen'},observed=[];
 const store={resolveForExecution:async(key,snapshot)=>{assert.equal(key,'ollama');observed.push(snapshot);assert.equal(snapshot.credentialSecretRef,secretRef);assert.equal(snapshot.repositoryRevision,'frozen');assert.deepEqual(snapshot.providerConfiguration,current.definition.configuration);return{...snapshot,credential:'exact-frozen-key'}}},models=new ProviderModelService({listRuntimeModels:async(safe,key)=>{assert.equal(key,'exact-frozen-key');assert.deepEqual(safe,definition('bearer').configuration);return['model:tag']}});
 assert.deepEqual(await listSavedProviderModels('ollama','ollama-chat',undefined,{getConnection:async()=>current},store,models),['model:tag']);assert.equal(observed.length,1);
});

test('official Cloud requires explicit Bearer in canonical configuration and saved definitions while custom origins keep both modes',()=>{
 for(const baseUrl of ['https://ollama.com','HTTPS://OLLAMA.COM:443/']){
  assert.throws(()=>policy.safeConfiguration.parse({baseUrl,authMode:'none'}));
  assert.equal(connectionDefinitionSchema.safeParse({...definition(),configuration:{baseUrl,authMode:'none'}}).success,false);
  assert.equal(policy.safeConfiguration.parse({baseUrl,authMode:'bearer'}).baseUrl,'https://ollama.com');
  assert.equal(connectionDefinitionSchema.safeParse({...definition('bearer'),configuration:{baseUrl,authMode:'bearer'}}).success,true);
 }
 for(const baseUrl of ['http://ollama:11434','https://custom.example','http://ollama.com','https://ollama.com:8443'])for(const authMode of ['none','bearer'])assert.deepEqual(policy.safeConfiguration.parse({baseUrl,authMode}),{baseUrl,authMode});
});

test('invalid direct-cloud snapshots fail admission without resolving a credential or contacting a provider',async()=>{
 const {resolveWorkflowRunConnectionSnapshot}=await import('../lib/workflow-run-connection-snapshots.ts'),f=fixture(),snapshot=await f.store.getSafeDescriptor('ollama');
 await assert.rejects(resolveWorkflowRunConnectionSnapshot({...snapshot,providerConfiguration:{baseUrl:'https://ollama.com',authMode:'none'}},f.store),/ollama_configuration_invalid/);
 assert.deepEqual(f.calls,[]);
});
