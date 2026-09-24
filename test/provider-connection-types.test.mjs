import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {installTsxHook} from './render-tsx.mjs';
import {providerConnectionTypes,getProviderConnectionType,requireProviderConnectionType} from '../lib/provider-connection-types.ts';
import {ProviderModelService} from '../lib/provider-model-service.ts';

const requireTsx=installTsxHook();
const {ConnectionCatalogue}=requireTsx('../components/ConnectionCatalogue.tsx');

test('registry exposes safe OpenAI connection policy and rejects unsupported identities',()=>{
 assert.deepEqual(providerConnectionTypes.map(item=>item.id),['openai-responses','openai-agents']);
 assert.equal(getProviderConnectionType('openai-agents').execution,'adt-runtime');
 assert.equal(getProviderConnectionType('openai-responses').capabilities.cancellation,true);
 assert.throws(()=>requireProviderConnectionType('anthropic'),/connection_unavailable/);
 assert.doesNotMatch(JSON.stringify(providerConnectionTypes),/secret|token|credential/i);
});

test('provider model service dispatches OpenAI discovery and validation',async()=>{
 const calls=[];const service=new ProviderModelService({listOpenAIModels:async credential=>{calls.push(['list',credential]);return['gpt-5']},validateOpenAIModel:async(credential,model)=>{calls.push(['validate',credential,model])}});
 assert.deepEqual(await service.list('openai-agents','key'),['gpt-5']);
 await service.validate('openai-responses','key','gpt-5');
 assert.deepEqual(calls,[['list','key'],['validate','key','gpt-5']]);
 await assert.rejects(service.list('unsupported','key'),/connection_unavailable/);
});

test('catalogue uses registered labels and omits absent models',()=>{
 const base={enabled:true,configured:true,management:'git',capabilities:{asynchronous:true,cancellation:true}};
 const html=renderToStaticMarkup(React.createElement(ConnectionCatalogue,{connections:[{...base,key:'responses',name:'Responses',adapter:'openai-responses',defaultModel:'gpt-5'},{...base,key:'agents',name:'Agents',adapter:'openai-agents'}]}));
 assert.match(html,/OpenAI Responses/);assert.match(html,/OpenAI Agents \/ ADT Runtime/);
 assert.equal((html.match(/<dt>Model<\/dt>/g)||[]).length,1);
});
