import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {installTsxHook} from './render-tsx.mjs';
import {providerConnectionTypes,getProviderConnectionType,requireProviderConnectionType,normalizeConnectionModel,connectionRequestModel,usesOpenAIModelAgentSettings,createStringSafeConfigurationPolicy} from '../lib/provider-connection-types.ts';
import {buildProviderConnectionDefinition} from '../lib/provider-connection-definition-policy.ts';
import {ProviderModelService} from '../lib/provider-model-service.ts';
import {validateProviderConnectionReadiness} from '../lib/git-workflow-provider-connection-store.ts';

const requireTsx=installTsxHook();
const {ConnectionCatalogue}=requireTsx('../components/ConnectionCatalogue.tsx');
const {providerConnectionConfigurationPayload}=requireTsx('../components/ProviderConnectionEditor.tsx');
const credential={source:'adt-vault',secretRef:`sec_${'a'.repeat(43)}`};
const syntheticConfiguration=createStringSafeConfigurationPolicy({tenantId:{required:true,maxLength:80,pattern:/^[a-z0-9-]+$/},clientId:{required:true,maxLength:80,pattern:/^[a-z0-9-]+$/}});
const futurePolicy={id:'synthetic-provider',provider:'synthetic',label:'Synthetic',catalogueLabel:'Synthetic',authentication:'delegated-oauth',model:{required:false,discovery:false},capabilities:{asynchronous:false,cancellation:false},execution:'direct',agentSettings:'none',safeConfiguration:syntheticConfiguration};

test('policy shape supports non-OpenAI authentication, model, and Agent-setting semantics without registration',()=>{
 assert.equal(futurePolicy.authentication,'delegated-oauth');assert.deepEqual(normalizeConnectionModel(futurePolicy,'stale-model'),{});assert.equal(usesOpenAIModelAgentSettings(futurePolicy),false);
 assert.equal(getProviderConnectionType(futurePolicy.id),undefined);assert.throws(()=>requireProviderConnectionType(futurePolicy.id),/connection_unavailable/);
});

test('registry contains only safe current provider connection policies',()=>{
 assert.deepEqual(providerConnectionTypes.map(item=>item.id),['openai-responses','openai-agents','anthropic-messages']);
 assert.equal(getProviderConnectionType('openai-agents').execution,'adt-runtime');const anthropic=getProviderConnectionType('anthropic-messages');assert.equal(anthropic.provider,'anthropic');assert.equal(anthropic.authentication,'api-key');assert.deepEqual(anthropic.model,{required:true,discovery:true,discoveryGuidance:'Load models available to this authenticated Anthropic account or workspace.'});assert.deepEqual(anthropic.capabilities,{asynchronous:false,cancellation:false});assert.equal(anthropic.execution,'direct');assert.equal(anthropic.agentSettings,'anthropic-messages');assert.equal(anthropic.safeConfiguration.parse(undefined),undefined);assert.equal(getProviderConnectionType('openai-responses').agentSettings,'openai-model');
 assert.doesNotMatch(JSON.stringify(providerConnectionTypes),/secret|token|credential/i);
});

test('model policy requires current OpenAI models and strips stale models for a no-model policy',()=>{
 assert.throws(()=>normalizeConnectionModel(getProviderConnectionType('openai-responses'),''),/model_required/);
 const previous={schemaVersion:1,id:'connection',name:'Connection',runtime:'openai-responses',provider:'openai',model:'gpt-5',credential};
 const normalized=buildProviderConnectionDefinition(futurePolicy,{schemaVersion:1,id:previous.id,name:previous.name,credential:previous.credential},previous.model,{tenantId:'tenant-1',clientId:'client-1'});
 assert.deepEqual(normalized.configuration,{tenantId:'tenant-1',clientId:'client-1'});assert.equal('model' in normalized,false);assert.equal(normalized.runtime,'synthetic-provider');assert.deepEqual(connectionRequestModel(futurePolicy,''),{});
});

test('provider model service dispatches OpenAI and skips or rejects operations according to model policy',async()=>{
 const calls=[];const service=new ProviderModelService({listOpenAIModels:async credential=>{calls.push(['list',credential]);return['gpt-5']},validateOpenAIModel:async(credential,model)=>{calls.push(['validate',credential,model])}});
 assert.deepEqual(await service.list('openai-agents','key'),['gpt-5']);await service.validate('openai-responses','key','gpt-5');
 await service.validateForPolicy(futurePolicy,'unused','stale-model');assert.deepEqual(calls,[['list','key'],['validate','key','gpt-5']]);
 await assert.rejects(service.listForPolicy(futurePolicy,'unused'),/model_discovery_unsupported/);await assert.rejects(service.list('unsupported','key'),/connection_unavailable/);
});

test('model-less readiness never invokes model validation',async()=>{let calls=0;await validateProviderConnectionReadiness(futurePolicy,'credential','stale-model',async()=>{calls++});assert.equal(calls,0)});

test('catalogue uses registered labels and omits absent models',()=>{
 const base={enabled:true,configured:true,management:'git',capabilities:{asynchronous:true,cancellation:true}};
 const html=renderToStaticMarkup(React.createElement(ConnectionCatalogue,{connections:[{...base,key:'responses',name:'Responses',adapter:'openai-responses',defaultModel:'gpt-5'},{...base,key:'agents',name:'Agents',adapter:'openai-agents'}]}));
 assert.match(html,/OpenAI Responses/);assert.match(html,/OpenAI Agents \/ ADT Runtime/);assert.equal((html.match(/<dt>Model<\/dt>/g)||[]).length,1);
});

test('synthetic safe configuration is strict, normalized, and secret fields are denied',()=>{assert.deepEqual(syntheticConfiguration.parse({tenantId:' tenant-1 ',clientId:'client-1'}),{tenantId:'tenant-1',clientId:'client-1'});for(const value of [{tenantId:'tenant-1'},{tenantId:'tenant-1',clientId:'client-1',unknown:'x'},...['clientSecret','refreshToken','accessToken','authorizationCode','apiKey'].map(key=>({tenantId:'tenant-1',clientId:'client-1',[key]:'secret'}))])assert.throws(()=>syntheticConfiguration.parse(value),/provider_configuration_invalid/)});

test('OpenAI definitions retain their historical shape without empty configuration',()=>{const policy=getProviderConnectionType('openai-responses'),definition=buildProviderConnectionDefinition(policy,{schemaVersion:1,id:'openai',name:'OpenAI',credential},'gpt-5');assert.deepEqual(Object.keys(definition).sort(),['credential','id','model','name','provider','runtime','schemaVersion']);assert.equal('configuration' in definition,false)});

test('target policy rebuilding drops prior provider configuration',()=>{const first=buildProviderConnectionDefinition(futurePolicy,{schemaVersion:1,id:'connection',name:'Connection',credential},undefined,{tenantId:'tenant-1',clientId:'client-1'}),openAI=buildProviderConnectionDefinition(getProviderConnectionType('openai-agents'),{schemaVersion:1,id:first.id,name:first.name,credential:first.credential},'gpt-5');assert.equal('configuration' in openAI,false);assert.deepEqual(providerConnectionConfigurationPayload(futurePolicy,{tenantId:'tenant-1',clientId:'client-1'}),{configuration:{tenantId:'tenant-1',clientId:'client-1'}})});
