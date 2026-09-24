import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {installTsxHook} from './render-tsx.mjs';
import {providerConnectionTypes,getProviderConnectionType,requireProviderConnectionType,normalizeConnectionModel,connectionRequestModel,usesOpenAIModelAgentSettings} from '../lib/provider-connection-types.ts';
import {buildProviderConnectionDefinition} from '../lib/provider-connection-definition-policy.ts';
import {ProviderModelService} from '../lib/provider-model-service.ts';
import {validateProviderConnectionReadiness} from '../lib/git-workflow-provider-connection-store.ts';

const requireTsx=installTsxHook();
const {ConnectionCatalogue}=requireTsx('../components/ConnectionCatalogue.tsx');
const credential={source:'adt-vault',secretRef:`sec_${'a'.repeat(43)}`};
const futurePolicy={id:'synthetic-provider',provider:'synthetic',label:'Synthetic',catalogueLabel:'Synthetic',authentication:'delegated-oauth',model:{required:false,discovery:false},capabilities:{asynchronous:false,cancellation:false},execution:'direct',agentSettings:'none'};

test('policy shape supports non-OpenAI authentication, model, and Agent-setting semantics without registration',()=>{
 assert.equal(futurePolicy.authentication,'delegated-oauth');assert.deepEqual(normalizeConnectionModel(futurePolicy,'stale-model'),{});assert.equal(usesOpenAIModelAgentSettings(futurePolicy),false);
 assert.equal(getProviderConnectionType(futurePolicy.id),undefined);assert.throws(()=>requireProviderConnectionType(futurePolicy.id),/connection_unavailable/);
});

test('registry contains only safe current OpenAI connection policies',()=>{
 assert.deepEqual(providerConnectionTypes.map(item=>item.id),['openai-responses','openai-agents']);
 assert.equal(getProviderConnectionType('openai-agents').execution,'adt-runtime');assert.equal(getProviderConnectionType('openai-responses').agentSettings,'openai-model');
 assert.doesNotMatch(JSON.stringify(providerConnectionTypes),/secret|token|credential/i);
});

test('model policy requires current OpenAI models and strips stale models for a no-model policy',()=>{
 assert.throws(()=>normalizeConnectionModel(getProviderConnectionType('openai-responses'),''),/model_required/);
 const previous={schemaVersion:1,id:'connection',name:'Connection',runtime:'openai-responses',provider:'openai',model:'gpt-5',credential};
 const normalized=buildProviderConnectionDefinition(futurePolicy,{schemaVersion:1,id:previous.id,name:previous.name,credential:previous.credential},previous.model);
 assert.equal('model' in normalized,false);assert.equal(normalized.runtime,'synthetic-provider');assert.deepEqual(connectionRequestModel(futurePolicy,''),{});
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
