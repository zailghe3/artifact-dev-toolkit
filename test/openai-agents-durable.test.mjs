import test from 'node:test';
import assert from 'node:assert/strict';
import {Agent,Runner} from '@openai/agents';
import {ScriptedModel,assistantMessage} from '@openai/agents/testing';
import {AgentRuntimeRegistry} from '../lib/agent-runtime.ts';
import {OpenAIAgentsRuntime} from '../lib/openai-agents-runtime.ts';
import {agentDefinitionSchema,buildSequentialWorkflow} from '../lib/workflow-definitions.ts';
import {executeDurableWorkflow} from '../lib/workflow-durable-driver.ts';
import {InMemoryWorkflowRunStorage,newWorkflowRun} from '../lib/workflow-storage.ts';
import {safeConnectionSnapshot} from '../lib/workflow-connections.ts';

class Step {async do(_name,configOrOperation,operation){return (operation??configOrOperation)()}async sleep(){}}
const connection={key:'sdk-openai',name:'SDK OpenAI',adapter:'openai-agents',endpoint:'https://api.openai.com/v1',defaultModel:'gpt-5',enabled:true,management:'git',credentialSecretRef:'WORKFLOW_PROVIDER_CONNECTION_SDK_OPENAI',repositoryRevision:'connection-sha',capabilities:{asynchronous:false,cancellation:false},credential:'runtime-only-secret'};
const agent=(id,name)=>agentDefinitionSchema.parse({schemaVersion:1,id,name,description:'',status:'draft',masterPrompt:`Prompt ${name}`,connectionKey:connection.key,adapterOptions:{reasoningEffort:'low'}});
function runFixture(id,agents,initialInput){const workflow=buildSequentialWorkflow({id:`flow-${id}`,name:'SDK flow',agents});return newWorkflowRun({id,workflow,revision:'workflow-sha',agents,agentRevisions:Object.fromEntries(agents.map(value=>[value.id,`${value.id}-sha`])),connections:[safeConnectionSnapshot(connection)],initialInput,clientIdempotencyKey:`client-${id}`})}
function runtimeFor(models){return new OpenAIAgentsRuntime({createProvider:()=>({getModel:async()=>models.shift(),close:async()=>{}}),createRunner:configuration=>new Runner(configuration),createAgent:configuration=>new Agent(configuration)})}

test('durable driver persists exact SDK output and hands only that text to the next SDK step',async()=>{
 const agents=[agent('first','First'),agent('second','Second')],initial='  exact initial\r\ninput  ',firstOutput='  exact first\noutput  ',finalOutput='final SDK text';
 const models=[new ScriptedModel([[assistantMessage(firstOutput)]]),new ScriptedModel([[assistantMessage(finalOutput)]])],storage=new InMemoryWorkflowRunStorage(),run=runFixture('sdk-handoff',agents,initial);
 await storage.createRun(run);
 await executeDurableWorkflow({runId:run.id,storage,runtimes:new AgentRuntimeRegistry([runtimeFor(models)]),resolveConnection:async(_key,snapshot)=>({...snapshot,enabled:true,credential:connection.credential}),step:new Step()});
 const detail=await storage.getRun(run.id),first=detail.attempts.find(value=>value.stepId==='step-1'),second=detail.attempts.find(value=>value.stepId==='step-2');
 assert.equal(detail.run.status,'succeeded');assert.equal(first.inputText,initial);assert.equal(first.outputText,firstOutput);assert.equal(second.inputText,firstOutput);assert.equal(second.outputText,finalOutput);assert.equal(detail.run.finalOutput,finalOutput);
 assert.equal(JSON.stringify(models), '[]');assert.equal(JSON.stringify(detail).includes('runtime-only-secret'),false);assert.equal(first.providerTaskId,undefined);assert.equal(second.providerTaskId,undefined);assert.equal(first.providerState,'completed');assert.equal(second.providerState,'completed');assert.doesNotMatch(JSON.stringify(detail),/responseId|previousResponseId|conversationId|session/);
});

test('durable driver does not automatically replay an ambiguous synchronous SDK failure',async()=>{
 const agents=[agent('only','Only')],model=new ScriptedModel([{type:'error',error:Object.assign(new Error('private upstream failure'),{status:503})}]),storage=new InMemoryWorkflowRunStorage(),run=runFixture('sdk-no-replay',agents,'input');
 await storage.createRun(run);
 await executeDurableWorkflow({runId:run.id,storage,runtimes:new AgentRuntimeRegistry([runtimeFor([model])]),resolveConnection:async(_key,snapshot)=>({...snapshot,enabled:true,credential:connection.credential}),step:new Step()});
 const detail=await storage.getRun(run.id);assert.equal(detail.run.status,'failed');assert.equal(detail.attempts.length,1);assert.equal(detail.attempts[0].failureCategory,'provider_unavailable');assert.equal(detail.attempts[0].retryable,false);assert.equal(model.calls.length,1);assert.doesNotMatch(JSON.stringify(detail),/private upstream|runtime-only-secret/);
});
