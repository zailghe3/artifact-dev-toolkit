import test from 'node:test';
import assert from 'node:assert/strict';
import {installTsxHook} from './render-tsx.mjs';

const require=installTsxHook();
const {validateCodexRunnerOptionsAgainstSnapshot}=require('../lib/codex-runner-agent-options.ts');
const {workflowError}=require('../lib/workflow-http.ts');
const base={configured:true,reachable:true,capabilitiesAvailable:true,codexAvailable:true,jobExecution:true,environmentCatalogAvailable:true,authenticated:true,authStatusAvailable:true,modelCatalogAvailable:true,available:true,environments:[{key:'dev',name:'Development',enabled:true,ready:true,sandbox:'workspace-write'},{key:'offline',name:'Offline',enabled:false,ready:false,sandbox:'read-only'}],models:[{id:'codex-a',displayName:'Codex A',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium',description:''},{reasoningEffort:'high',description:''}]}]};

test('live Codex validation accepts public Runner catalogue tokens',()=>{assert.deepEqual(validateCodexRunnerOptionsAgainstSnapshot({environmentKey:'dev',model:'codex-a',reasoningEffort:'high'},base),{environmentKey:'dev',model:'codex-a',reasoningEffort:'high'})});
test('live Codex validation rejects unavailable environments, models, and reasoning efforts',()=>{for(const [options,message] of [[{environmentKey:'missing'},'codex_environment_unavailable'],[{environmentKey:'offline'},'codex_environment_unavailable'],[{environmentKey:'dev',model:'missing'},'codex_model_unavailable'],[{environmentKey:'dev',reasoningEffort:'xhigh'},'codex_reasoning_effort_unavailable']])assert.throws(()=>validateCodexRunnerOptionsAgainstSnapshot(options,base),new RegExp(message))});
test('live Codex validation fails closed for independent Runner readiness dimensions',()=>{for(const [change,message] of [[{reachable:false},'connection_unavailable'],[{capabilitiesAvailable:false},'codex_capabilities_unavailable'],[{codexAvailable:false},'codex_unavailable'],[{jobExecution:false},'codex_job_execution_unavailable'],[{environmentCatalogAvailable:false},'codex_environment_catalog_unavailable'],[{authStatusAvailable:false},'codex_auth_status_unavailable'],[{authStatusAvailable:true,authenticated:false},'codex_authentication_unavailable'],[{modelCatalogAvailable:false},'codex_model_catalog_unavailable']])assert.throws(()=>validateCodexRunnerOptionsAgainstSnapshot({environmentKey:'dev'},{...base,...change}),new RegExp(message))});

test('auth discovery and confirmed disconnection have distinct safe HTTP feedback',async()=>{for(const [code,message] of [['codex_auth_status_unavailable','ChatGPT connection status is unavailable.'],['codex_authentication_unavailable','ChatGPT is not connected on the Codex Runner.']]){const response=workflowError(new Error(code));assert.equal(response.status,422);assert.deepEqual(await response.json(),{code,error:message})}});

test('definition compatibility errors have stable safe HTTP responses',async()=>{
  const {DefinitionLayoutCollisionError}=require('../lib/workflow-definition-repository.ts');
  let response=workflowError(new DefinitionLayoutCollisionError('reviewer',['_adt/agents/reviewer.agent.json','agents/reviewer.agent.json']));
  assert.equal(response.status,409);assert.deepEqual(await response.json(),{code:'definition_layout_collision',error:'A definition ID exists in both repository layouts.',identity:'reviewer',paths:['_adt/agents/reviewer.agent.json','agents/reviewer.agent.json']});
});
