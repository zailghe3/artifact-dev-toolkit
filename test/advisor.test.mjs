import {ADT_DATA_TOOLS} from "../lib/adt-data-contract.ts";
import {DEFAULT_ARTIFACT_ROOT} from "../lib/artifact-contract.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {applyAdvisorOverride,assertAdvisorReadOnly,assertAdvisorRunReadOnly} from '../lib/advisor-policy.ts';
import {validateAdvisorSelection} from '../lib/advisor-configuration.ts';
import {InMemoryWorkflowDefinitionRepository} from '../lib/workflow-definition-repository.ts';
import {manualRetryEligibility,InMemoryWorkflowRunStorage} from '../lib/workflow-storage.ts';
import {D1WorkflowRunStorage} from '../lib/workflow-d1-storage.ts';
import {compileWorkflowV2ExecutionPlan,composeVersionedWorkflowV2,validateAgentForConnection} from '../lib/workflow-definitions.ts';
import {AgentRuntimeRegistry} from '../lib/agent-runtime.ts';
import {durableInvocation,executeDurableGraphNodeTurn} from '../lib/workflow-durable-driver.ts';
import {createAdvisorDefinitions} from '../scripts/create-advisor-definitions.mjs';
import {context,connection,agent,workflow,run,database} from './support/advisor-fixtures.mjs';
import {installTsxHook} from './render-tsx.mjs';
const requireTsx=installTsxHook(),{launchWorkflowRun}=requireTsx('../lib/workflow-run-admission.ts');
const access={...context,repo:context.repository,login:'user',githubId:1,checkedAt:Date.now(),ok:true};
const settings={workflowId:workflow.id,override:null};
async function fixture(){
 const storage=new InMemoryWorkflowRunStorage(),repo=new InMemoryWorkflowDefinitionRepository();await repo.createAgent(agent);await repo.createWorkflow(workflow);let launches=0,modelChecks=[];
 const deps={getWorkflowRunStorage:async()=>storage,createWorkflowDefinitionRepository:()=>repo,listWorkflowConnectionIdentityDescriptors:async()=>[connection,{...connection,key:'override',defaultModel:'gpt-5-mini'}],readCodexRunnerCatalog:async()=>({environments:[]}),listWorkflowConnectionDescriptors:async()=>[connection],getWorkflowEnvironment:async()=>({AGENT_RUN_WORKFLOW:{create:async({id})=>{launches++;return{id}}}}),getMcpPolicyAuthority:async()=>({}),getProviderCredentialVault:async()=>({}),createToolDefinitionRepository:()=>({list:async()=>[]}),createSecurityProfileDefinitionRepository:()=>({list:async()=>[]}),getWorkflowProviderConnectionStore:async()=>({resolveForSnapshot:async(key,snapshot)=>snapshot,resolveForExecution:async(key,snapshot)=>({...snapshot,credential:'SENSITIVE_CREDENTIAL'})}),getProviderModelService:async()=>({validate:async(...args)=>modelChecks.push(args)})};
 return{storage,repo,deps,launches:()=>launches,modelChecks};
}
test('a run freezes the selected Advisor provider override',async t=>{
 const db=await database(t);
 const storage=new D1WorkflowRunStorage(db),value=run({advisorContext:{version:1,readOnly:true,override:{connectionKey:'agents',model:'gpt-5'}}});await storage.createRun(value);
 assert.deepEqual((await new D1WorkflowRunStorage(db).getRun(value.id)).run.advisorContext,value.advisorContext);
});
test('override validates every affected Agent, keeps saved definitions intact and rejects incompatible providers and options',()=>{
 const other={...agent,id:'other'},original=structuredClone([agent,other]),connections=[connection,{...connection,key:'replacement',defaultModel:'gpt-5-mini'}],before=structuredClone(connections);
 const result=applyAdvisorOverride(original,connections,{connectionKey:'replacement',model:'gpt-5'});assert.deepEqual(result.agents.map(a=>a.connectionKey),['replacement','replacement']);assert.equal(result.connections[1].defaultModel,'gpt-5');assert.deepEqual(original,[agent,other]);assert.deepEqual(connections,before);
 for(const override of [{connectionKey:'missing',model:'gpt-5'},{connectionKey:'bad',model:'gpt-5'}])assert.throws(()=>applyAdvisorOverride([agent],[connection,{...connection,key:'bad',adapter:'codex-runner'}],override));
 const options={reasoningEffort:'high'};
 assert.deepEqual(applyAdvisorOverride([{...agent,adapterOptions:options}],[connection],{connectionKey:'agents',model:'vendor-preview'}).agents[0].adapterOptions,options);
 assert.throws(()=>applyAdvisorOverride([{...agent,adapterOptions:{reasoningEffort:'unknown-value'}}],[connection],{connectionKey:'agents',model:'vendor-preview'}),/advisor_provider_incompatible/);
 assert.throws(()=>validateAgentForConnection(agent,{...connection,adapter:'anthropic-messages',capabilities:{agentTools:false}}),/agent_tool_runtime_unsupported/);
});
test('Advisor launches through ordinary admission and freezes override choices for all Agents without mutating Git',async()=>{
 const f=await fixture(),override={workflowId:'review',override:{connectionKey:'override',model:'gpt-5'}},body={workflowId:'review',initialInput:'Where is review weak?',idempotencyKey:crypto.randomUUID()};
 const response=await launchWorkflowRun(access,body,override,f.deps);assert.equal(response.status,201,await response.clone().text());const {runId}=await response.json(),detail=await f.storage.getRun(runId);
 assert.equal(detail.run.workflowRevision,(await f.repo.getWorkflow('review')).fileSha);assert.equal(detail.run.advisorContext.readOnly,true);assert.equal(detail.run.agentSnapshots.analyst.connectionKey,'override');assert.equal(detail.run.connectionSnapshots.override.defaultModel,'gpt-5');assert.equal((await f.repo.getAgent('analyst')).definition.connectionKey,'agents');assert.equal(f.modelChecks.length,1);assert.equal(f.modelChecks[0][2],'gpt-5');assert.doesNotMatch(JSON.stringify(detail),/SENSITIVE_CREDENTIAL/);
 assert.equal(f.launches(),1);assert.equal((await launchWorkflowRun(access,body,override,f.deps)).status,200);assert.equal(f.launches(),1);
 assert.equal((await launchWorkflowRun(access,{...body,initialInput:'different'},override,f.deps)).status,409);
 assert.equal((await launchWorkflowRun({...access,repositoryId:99},body,override,f.deps)).status,409);
 assert.equal((await launchWorkflowRun(access,body,undefined,f.deps)).status,409);
 const ordinary=await launchWorkflowRun(access,{...body,idempotencyKey:crypto.randomUUID()},undefined,f.deps),ordinaryRun=await f.storage.getRun((await ordinary.json()).runId);assert.equal(ordinaryRun.run.advisorContext,undefined);assert.equal(ordinaryRun.run.agentSnapshots.analyst.connectionKey,'agents');assert.equal(ordinaryRun.run.connectionSnapshots.agents.defaultModel,'gpt-5');
});
test('selection and launch reject deleted workflows, stale definitions, tool escalation and incompatible model overrides',async()=>{
 const f=await fixture();assert.equal((await validateAdvisorSelection(settings,f.repo,[connection])).workflow.id,'review');
 await assert.rejects(validateAdvisorSelection({...settings,workflowId:'missing'},f.repo,[connection]),/advisor_workflow_invalid/);
 await assert.rejects(validateAdvisorSelection({...settings,workflowId:null,override:{connectionKey:'agents',model:'gpt-5'}},f.repo,[connection]),/advisor_workflow_required/);
 for(const tools of [['artifact_search'],[{type:'mcp',serverId:'external',toolName:'read_only_claim'}]]){
  const old=await f.repo.getAgent('analyst');await f.repo.updateAgent({...old.definition,tools},old.fileSha);await assert.rejects(validateAdvisorSelection(settings,f.repo,[connection]),/advisor_read_only_required/);
  const response=await launchWorkflowRun(access,{workflowId:'review',initialInput:'question',idempotencyKey:crypto.randomUUID()},settings,f.deps);assert.equal(response.status,422);assert.equal(f.launches(),0);
 }
 const stale=await f.repo.getWorkflow('review');await f.repo.deleteWorkflow('review',stale.fileSha);assert.equal((await launchWorkflowRun(access,{workflowId:'review',initialInput:'q',idempotencyKey:crypto.randomUUID()},settings,f.deps)).status,422);
 const fresh=await fixture();fresh.deps.getProviderModelService=async()=>({validate:async()=>{throw Error('model_unavailable')}});
 const unavailable=await launchWorkflowRun(access,{workflowId:'review',initialInput:'q',idempotencyKey:crypto.randomUUID()},{...settings,override:{connectionKey:'override',model:'vendor-model-preview'}},fresh.deps);
 assert.equal(unavailable.status,422);assert.equal((await unavailable.json()).code,'model_unavailable');assert.equal(fresh.launches(),0);
});
test('read-only admission expands reusable workflows and blocks indirect MCP, Codex and publication escalation',()=>{
 const leaf={...workflow,id:'leaf',exposableAsBlock:true},root={...workflow,nodes:[{id:'nested',blockType:'subworkflow',blockVersion:1,config:{workflowId:'leaf'}}]};
 const expanded=composeVersionedWorkflowV2({definition:root,fileSha:'root'},[{definition:root,fileSha:'root'},{definition:leaf,fileSha:'leaf'}]).workflow,plan=compileWorkflowV2ExecutionPlan(expanded,[agent]);
 assertAdvisorReadOnly(plan,[agent],[connection]);
 assert.throws(()=>assertAdvisorReadOnly(plan,[{...agent,tools:[{type:'mcp',serverId:'mutating',toolName:'execute_workflow'}]}],[connection]),/advisor_read_only_required/);
 assert.throws(()=>assertAdvisorReadOnly(plan,[agent],[{...connection,adapter:'codex-runner'}]),/advisor_provider_incompatible/);
 assert.throws(()=>assertAdvisorReadOnly({...plan,nodes:[...plan.nodes,{id:'publish',blockType:'publish-github-pr',blockVersion:1,config:{}}]},[agent],[connection]),/advisor_read_only_required/);
 const value=run({advisorContext:{version:1,readOnly:true,override:null}});value.mcpToolSnapshots={analyst:[{tool:{name:'mutate'}}]};assert.throws(()=>assertAdvisorRunReadOnly(value),/advisor_read_only_required/);
});
test('failed and cancelled Advisor runs retain frozen authority and reject generic retry of journaled activations',async()=>{
 const storage=new InMemoryWorkflowRunStorage(),value=run({advisorContext:{version:1,readOnly:true,override:null}});await storage.createRun(value);await storage.ensureGraphActivation(value.id,'analyse','activation');
 let calls=0;const seen=[],runtime={kind:'openai-agents',start:async call=>{calls++;seen.push(call);if(calls===1)throw Object.assign(Error('rejected'),{category:'provider_rejected'});return {state:'completed',outputText:'Evidence-based result'}},check:async()=>{throw Error('unused')},cancel:async()=> 'unsupported'};
 const input={runId:value.id,nodeId:'analyse',activationId:'activation',inputText:'question',storage,runtimes:new AgentRuntimeRegistry([runtime]),resolveConnection:async(key,snapshot)=>({...snapshot,credential:'private'})};
 assert.equal((await executeDurableGraphNodeTurn(input)).state,'failed');await assert.rejects(storage.prepareManualRetry(value.id,'analyse'),/invalid_retry/);assert.equal(manualRetryEligibility(await storage.getRun(value.id)).eligible,false);
 const frozen=await storage.getRun(value.id);assert.deepEqual(frozen.run.advisorContext,value.advisorContext);assert.deepEqual(frozen.run.agentSnapshots,value.agentSnapshots);
 // Even a forged recovered snapshot cannot turn credentials into mutating tool authority.
 const forged=structuredClone(frozen);forged.run.agentSnapshots.analyst.tools.push('artifact_search');await assert.rejects(durableInvocation(forged,forged.attempts.at(-1),input.resolveConnection),/advisor_read_only_required/);
 const cancelled=run({advisorContext:{version:1,readOnly:true,override:null}});await storage.createRun(cancelled);await storage.ensureGraphActivation(cancelled.id,'analyse','cancelled');await storage.requestCancellation(cancelled.id);assert.equal((await executeDurableGraphNodeTurn({...input,runId:cancelled.id,activationId:'cancelled'})).state,'cancelled');assert.equal(calls,1);
 // An interrupted synchronous invocation is reconciled, never restarted.
 const interrupted=run({advisorContext:{version:1,readOnly:true,override:null}});await storage.createRun(interrupted);await storage.ensureGraphActivation(interrupted.id,'analyse','interrupted');await storage.claimGraphNode(interrupted.id,'analyse','q','interrupted');assert.equal((await executeDurableGraphNodeTurn({...input,runId:interrupted.id,activationId:'interrupted'})).state,'pending');assert.equal(calls,1);
});
test('default definition setup is deterministic, ordinary, least-privilege and never overwrites files',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'advisor-setup-')),paths=await createAdvisorDefinitions(directory,'agents');
 const generatedAgent=JSON.parse(await readFile(paths.agentPath,'utf8')),generatedWorkflow=JSON.parse(await readFile(paths.workflowPath,'utf8'));assert.equal(generatedAgent.connectionKey,'agents');assert.equal(generatedWorkflow.nodes[0].config.agentId,generatedAgent.id);assert.deepEqual(generatedAgent.tools,[...ADT_DATA_TOOLS,"adt_advisor_knowledge_search"]);assert.equal('masterPrompt' in generatedAgent,false);
 await assert.rejects(createAdvisorDefinitions(directory,'agents'),/Refusing to overwrite/);await writeFile(paths.agentPath,'preserve');await assert.rejects(createAdvisorDefinitions(directory,'agents'));assert.equal(await readFile(paths.agentPath,'utf8'),'preserve');
});

test('a validated credentialless Ollama snapshot remains executable while historical credential authorities remain read-only',async()=>{
 const {isLegacyRunReadOnly}=await import('../lib/workflow-run-legacy.ts');
 const ollama={...connection,adapter:'ollama-chat',providerConfiguration:{baseUrl:'http://ollama:11434',authMode:'none'},credentialSource:undefined,credentialSecretRef:undefined};
 const value=run({connections:[ollama]});assert.equal(isLegacyRunReadOnly(value),false);
 for(const patch of [{credentialSource:'cloudflare-binding'},{credentialSecretRef:'unexpected'},{repositoryRevision:undefined},{providerConfiguration:{baseUrl:'https://ollama.com',authMode:'none'}},{providerConfiguration:{baseUrl:'http://ollama:11434',authMode:'bearer'}}])assert.equal(isLegacyRunReadOnly({...value,connectionSnapshots:{agents:{...ollama,...patch}}}),true);
});


test('default Advisor definitions validate across every supported tool-enabled provider',async()=>{
 const {defaultAdvisorDefinitions}=await import('../lib/advisor-default.ts'),{agent:defaultAgent}=defaultAdvisorDefinitions('agents');
 for(const [adapter,defaultModel] of [['openai-agents','gpt-5'],['anthropic-messages','claude-sonnet-4-5'],['ollama-chat','qwen3']]){
  assert.doesNotThrow(()=>validateAgentForConnection(defaultAgent,{...connection,adapter,defaultModel}));
 }
});


test('legacy direct Runtime execution explicitly rejects native metadata grants before inference',async()=>{
 const {RemoteOpenAIAgentsRuntime}=await import('../lib/adt-runtime-client.ts');let requests=0;
 const runtime=new RemoteOpenAIAgentsRuntime({},async()=>{requests++;throw Error('No transport is permitted')});
 await assert.rejects(runtime.start({connection,tools:['adt_workflow_read']}),error=>error.category==='configuration_invalid'&&/journaled/.test(error.safeMessage));assert.equal(requests,0);
});

test('Advisor validates the effective default, override, and Workflow tool restrictions',async()=>{
 const f=await fixture(),incompatible={...connection,defaultModel:'gpt-6-luna'};
 await assert.rejects(validateAdvisorSelection(settings,f.repo,[incompatible]),/GPT-6 Luna.*reasoning effort None/);
 const override={...settings,override:{connectionKey:connection.key,model:'vendor-model-preview'}};
 const selection=await validateAdvisorSelection(override,f.repo,[incompatible]);
 assert.equal(selection.agents[0].model,'vendor-model-preview');
 assert.equal(incompatible.defaultModel,'gpt-6-luna');

 const saved=await f.repo.getWorkflow(workflow.id);
 const restricted={...saved.definition,nodes:[{...saved.definition.nodes[0],blockVersion:4,config:{agentId:agent.id,toolRestrictions:{allowlist:[]}}}]};
 await f.repo.updateWorkflow(restricted,saved.fileSha);
 const toolFree=await validateAdvisorSelection({...settings,override:{...override.override,model:'gpt-6-luna'}},f.repo,[connection]);
 assert.equal(toolFree.agents[0].model,'gpt-6-luna');
});

test('Workflow and Advisor admission reject incompatible effective models before creating or launching a run',async()=>{
 const f=await fixture(),incompatible={...connection,defaultModel:'gpt-6-luna'};
 f.deps.listWorkflowConnectionDescriptors=async()=>[incompatible];
 f.deps.getProviderCredentialVault=async()=>assert.fail('Known API requirements must be checked before snapshotting');
 for(const advisor of [undefined,{...settings,override:{connectionKey:'override',model:'gpt-6-luna'}}]){
  const body={workflowId:workflow.id,initialInput:'question',idempotencyKey:crypto.randomUUID()};
  const response=await launchWorkflowRun(access,body,advisor,f.deps);
  assert.equal(response.status,422);
  const result=await response.json();
  assert.equal(result.code,'unsupported_model_option');
  assert.match(result.error,/GPT-6 Luna.*reasoning effort None/);
  assert.equal(await f.storage.findRunByIdempotencyKey(body.idempotencyKey),undefined);
 }
 assert.equal(f.modelChecks.length,0);
 assert.equal(f.launches(),0);
});

test('Workflow admission allows a model when every activation removes its tools',async()=>{
 const f=await fixture(),incompatible={...connection,defaultModel:'gpt-6-luna'};
 f.deps.listWorkflowConnectionDescriptors=async()=>[incompatible];
 const saved=await f.repo.getWorkflow(workflow.id);
 const restricted={...saved.definition,nodes:[{...saved.definition.nodes[0],blockVersion:4,config:{agentId:agent.id,toolRestrictions:{allowlist:[]}}}]};
 const revision=await f.repo.updateWorkflow(restricted,saved.fileSha);
 const body={workflowId:workflow.id,initialInput:'question',idempotencyKey:crypto.randomUUID()};
 const response=await launchWorkflowRun(access,body,undefined,f.deps);
 assert.equal(response.status,201,await response.clone().text());
 const {runId}=await response.json(),detail=await f.storage.getRun(runId);
 assert.equal(detail.run.connectionSnapshots.agents.defaultModel,'gpt-6-luna');
 assert.deepEqual(detail.run.executionPlan.nodes[0].config.toolRestrictions.allowlist,[]);
 assert.deepEqual(detail.run.agentSnapshots.analyst.tools,agent.tools);

 const next={...restricted,nodes:[...restricted.nodes,{id:'verify',blockType:'agent',blockVersion:1,config:{agentId:agent.id}}],edges:[{id:'analyse-verify',source:'analyse',target:'verify'}]};
 await f.repo.updateWorkflow(next,revision.fileSha);
 const rejected=await launchWorkflowRun(access,{...body,idempotencyKey:crypto.randomUUID()},undefined,f.deps);
 assert.equal(rejected.status,422);
 assert.equal((await rejected.json()).code,'unsupported_model_option');
 assert.equal(f.launches(),1);
});

test('frozen Advisor runs with a historically accepted model remain readable and idempotent',async t=>{
 const db=await database(t),storage=new D1WorkflowRunStorage(db),override={connectionKey:'agents',model:'gpt-6-luna'};
 const historical=run({
  connections:[{...connection,defaultModel:override.model}],
  advisorContext:{version:1,readOnly:true,override},
  repositoryContext:{...context,root:DEFAULT_ARTIFACT_ROOT},
  clientIdempotencyKey:crypto.randomUUID(),
 });
 await storage.createRun(historical);
 await storage.claimWorkflowLaunch(historical.id,1,"historical-instance");
 await storage.attachWorkflowInstance(historical.id,1,"historical-instance");
 await storage.failRun(historical.id,'configuration_invalid','The model has no verified tool capability.');
 const detail=await new D1WorkflowRunStorage(db).getRun(historical.id);
 assert.equal(detail.run.connectionSnapshots.agents.defaultModel,override.model);
 assert.equal(detail.run.failureCode,'configuration_invalid');
 assert.doesNotThrow(()=>assertAdvisorRunReadOnly(detail.run));
 const response=await launchWorkflowRun(access,{workflowId:historical.workflowId,initialInput:historical.initialInput,idempotencyKey:historical.clientIdempotencyKey},{workflowId:historical.workflowId,override},{
  getWorkflowRunStorage:async()=>storage,
  createWorkflowDefinitionRepository:()=>assert.fail('Existing runs must read frozen history'),
  getWorkflowEnvironment:async()=>({AGENT_RUN_WORKFLOW:{create:async()=>assert.fail('A terminal run must not be relaunched')}}),
 });
 assert.equal(response.status,200,await response.clone().text());
 assert.equal((await response.json()).runId,historical.id);
});
