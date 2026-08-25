import test from 'node:test';
import assert from 'node:assert/strict';
import {AdapterBackedAgentRuntime,createAgentRuntimeRegistry} from '../lib/agent-runtime.ts';

const invocation={runId:'run',stepId:'step',iteration:1,attempt:1,providerPollCount:0,idempotencyKey:'run:step:1:1',agentName:'Agent',masterPrompt:'Prompt',inputText:'Input',connection:{key:'fixture',name:'Fixture',adapter:'fixture',enabled:true,capabilities:{asynchronous:true,cancellation:true},credential:'secret'}};

test('production AgentRuntime registry resolves every current execution implementation and no fallback',()=>{
 const registry=createAgentRuntimeRegistry();
 for(const kind of ['deterministic-test','openai-responses','codex-runner','codex-cloud'])assert.equal(registry.resolve(kind)?.kind,kind);
 assert.equal(registry.resolve('unknown-runtime'),undefined);
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
