import test from 'node:test';
import assert from 'node:assert/strict';
import {Agent,Runner} from '@openai/agents';
import {ScriptedModel,assistantMessage} from '@openai/agents/testing';
import {AdapterBackedAgentRuntime,createAgentRuntimeRegistry} from '../lib/agent-runtime.ts';
import {OpenAIAgentsRuntime,OPENAI_AGENTS_MAX_TURNS} from '../lib/openai-agents-runtime.ts';

const invocation={runId:'run',stepId:'step',iteration:1,attempt:1,providerPollCount:0,idempotencyKey:'run:step:1:1',agentName:'Agent',masterPrompt:'Prompt',inputText:'Input',connection:{key:'fixture',name:'Fixture',adapter:'fixture',enabled:true,capabilities:{asynchronous:true,cancellation:true},credential:'secret'}};

test('production AgentRuntime registry resolves every current execution implementation and no fallback',()=>{
 const registry=createAgentRuntimeRegistry();
 for(const kind of ['deterministic-test','openai-responses','openai-agents','codex-runner','codex-cloud'])assert.equal(registry.resolve(kind)?.kind,kind);
 assert.equal(registry.resolve('unknown-runtime'),undefined);
});

test('OpenAI Agents runtime executes the official SDK with exact input, instructions, and private settings',async()=>{
 const model=new ScriptedModel([[assistantMessage('  exact SDK output  ')]]),observed={};
 const runtime=new OpenAIAgentsRuntime({
  createProvider:configuration=>{observed.provider=configuration;return{getModel:async name=>{observed.requestedModel=name;return model},close:async()=>{observed.closed=true}}},
  createRunner:configuration=>{observed.runner=configuration;return new Runner(configuration)},
  createAgent:configuration=>{observed.agent=configuration;return new Agent(configuration)},
 });
 const call={...invocation,inputText:'  exact\r\nworkflow input  ',masterPrompt:'Exact master prompt',connection:{...invocation.connection,adapter:'openai-agents',endpoint:'https://api.openai.com/v1',defaultModel:'gpt-5',capabilities:{asynchronous:false,cancellation:false}},providerOptions:{reasoningEffort:'high',verbosity:'low',maxOutputTokens:321}};
 assert.deepEqual(await runtime.start(call),{state:'completed',outputText:'  exact SDK output  '});
 assert.deepEqual(observed.provider,{apiKey:'secret',useResponses:true});
 assert.equal(observed.runner.tracingDisabled,true);assert.equal(observed.runner.modelProvider!==undefined,true);
 assert.equal(observed.requestedModel,'gpt-5');assert.equal(observed.agent.instructions,'Exact master prompt');assert.equal(observed.agent.model,'gpt-5');
 assert.deepEqual(observed.agent.modelSettings,{store:false,parallelToolCalls:false,maxTokens:321,reasoning:{effort:'high'},text:{verbosity:'low'}});
 assert.equal(model.firstCall.request.systemInstructions,'Exact master prompt');
 assert.equal(JSON.stringify(model.firstCall.request.input).includes('  exact\\r\\nworkflow input  '),true);
 assert.equal(model.firstCall.request.modelSettings.retry,undefined);assert.equal(observed.closed,true);model.assertComplete();
 assert.equal(OPENAI_AGENTS_MAX_TURNS,1);
});

test('OpenAI Agents runtime isolates providers and fails closed for unsupported lifecycle operations',async()=>{
 const providers=[];
 const make=output=>new ScriptedModel([[assistantMessage(output)]]);
 const models=[make('A'),make('B')];
 const runtime=new OpenAIAgentsRuntime({createProvider:configuration=>{providers.push(configuration);const model=models.shift();return{getModel:async()=>model,close:async()=>{}}},createRunner:configuration=>new Runner(configuration),createAgent:configuration=>new Agent(configuration)});
 const base={...invocation,connection:{...invocation.connection,adapter:'openai-agents',endpoint:'https://api.openai.com/v1',defaultModel:'gpt-5',capabilities:{asynchronous:false,cancellation:false}}};
 assert.equal((await runtime.start({...base,connection:{...base.connection,credential:'credential-a'}})).outputText,'A');
 assert.equal((await runtime.start({...base,connection:{...base.connection,credential:'credential-b'}})).outputText,'B');
 assert.deepEqual(providers,[{apiKey:'credential-a',useResponses:true},{apiKey:'credential-b',useResponses:true}]);
 assert.equal(await runtime.cancel('not-a-task',base),'unsupported');
 await assert.rejects(runtime.check('not-a-task',base),error=>error.category==='configuration_invalid'&&error.retryable===false);
});

test('OpenAI Agents provider failures are safely classified and never marked retryable',async()=>{
 for(const [status,category] of [[401,'authentication_failed'],[403,'permission_denied'],[429,'rate_limited'],[503,'provider_unavailable'],[400,'provider_rejected']]){
  const runtime=new OpenAIAgentsRuntime({createProvider:()=>({getModel:async()=>new ScriptedModel([{type:'error',error:Object.assign(new Error('raw credential body'),{status})}])}),createRunner:configuration=>new Runner(configuration),createAgent:configuration=>new Agent(configuration)});
  const call={...invocation,connection:{...invocation.connection,adapter:'openai-agents',endpoint:'https://api.openai.com/v1',defaultModel:'gpt-5',capabilities:{asynchronous:false,cancellation:false}}};
  await assert.rejects(runtime.start(call),error=>{assert.equal(error.category,category);assert.equal(error.retryable,false);assert.doesNotMatch(error.safeMessage,/raw|credential/);return true});
 }
});

test('adapter-backed runtime delegates start, observation, and supported cancellation unchanged',async()=>{
 const calls=[];
 const adapter={kind:'fixture',validateConnection:async()=>({ok:true}),start:async value=>{calls.push(['start',value]);return{state:'pending',taskId:'task-1',pollAfterMs:25}},check:async(task,value)=>{calls.push(['check',task,value]);return{state:'completed',outputText:'done'}},cancel:async(task,value)=>{calls.push(['cancel',task,value]);return'cancellation_pending'}};
 const runtime=new AdapterBackedAgentRuntime(adapter);
 assert.deepEqual(await runtime.start(invocation),{state:'pending',taskId:'task-1',pollAfterMs:25});
 assert.deepEqual(await runtime.check('task-1',invocation),{state:'completed',outputText:'done'});
 assert.equal(await runtime.cancel('task-1',invocation),'cancellation_pending');
 assert.deepEqual(calls.map(call=>call.slice(0,2)),[['start',invocation],['check','task-1'],['cancel','task-1']]);
});

test('adapter-backed runtime reports unsupported cancellation when the adapter has no operation',async()=>{
 const runtime=new AdapterBackedAgentRuntime({kind:'fixture',validateConnection:async()=>({ok:true}),start:async()=>({state:'completed',outputText:'done'}),check:async()=>({state:'completed',outputText:'done'})});
 assert.equal(await runtime.cancel('task-1',invocation),'unsupported');
});
