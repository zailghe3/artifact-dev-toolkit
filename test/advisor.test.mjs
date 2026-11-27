import {ADT_DATA_TOOLS} from "../lib/adt-data-contract.ts";
import {DEFAULT_ARTIFACT_ROOT} from "../lib/artifact-contract.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertReadOnlyExecution,assertRunExecutionPolicy,requiredExecutionPolicy} from '../lib/workflow-execution-policy.ts';
import {InMemoryWorkflowDefinitionRepository} from '../lib/workflow-definition-repository.ts';
import {manualRetryEligibility,InMemoryWorkflowRunStorage} from '../lib/workflow-storage.ts';
import {D1WorkflowRunStorage} from '../lib/workflow-d1-storage.ts';
import {compileWorkflowV2ExecutionPlan,composeVersionedWorkflowV2,validateAgentForConnection} from '../lib/workflow-definitions.ts';
import {AgentRuntimeRegistry} from '../lib/agent-runtime.ts';
import {durableInvocation,executeDurableGraphNodeTurn} from '../lib/workflow-durable-driver.ts';
import {createAdvisorDefinitions} from '../scripts/create-advisor-definitions.mjs';
import {context,connection,agent,workflow,run,database} from './support/advisor-fixtures.mjs';
import {installTsxHook} from './render-tsx.mjs';
const requireTsx=installTsxHook(),{launchWorkflowRun,resolveWorkflowRunSnapshot}=requireTsx('../lib/workflow-run-admission.ts');
const access={...context,repo:context.repository,login:'user',githubId:1,checkedAt:Date.now(),ok:true};
async function fixture(){
 const storage=new InMemoryWorkflowRunStorage(),repo=new InMemoryWorkflowDefinitionRepository();await repo.createAgent(agent);await repo.createWorkflow(workflow);
 const deps={getWorkflowRunStorage:async()=>storage,createWorkflowDefinitionRepository:()=>repo,listWorkflowConnectionIdentityDescriptors:async()=>[connection],readCodexRunnerCatalog:async()=>({environments:[]}),listWorkflowConnectionDescriptors:async()=>[connection],getMcpPolicyAuthority:async()=>({}),getProviderCredentialVault:async()=>({}),createToolDefinitionRepository:()=>({list:async()=>[]}),createSecurityProfileDefinitionRepository:()=>({list:async()=>[]}),getWorkflowProviderConnectionStore:async()=>({resolveForSnapshot:async(key,snapshot)=>snapshot})};
 return{storage,repo,deps,countRuns:async()=>(await storage.listRuns()).length};
}
test('a run freezes the selected Advisor provider override',async t=>{
 const db=await database(t);
 const storage=new D1WorkflowRunStorage(db),value=run({advisorContext:{version:1,readOnly:true,override:{connectionKey:'agents',model:'gpt-5'}}});await storage.createRun(value);
 assert.deepEqual((await new D1WorkflowRunStorage(db).getRun(value.id)).run.advisorContext,value.advisorContext);
});
test('the configured Advisor identity uses the same snapshot admission as other Workflows',async()=>{
 const f=await fixture();
 const previous=await f.repo.createWorkflow({...workflow,id:'advisor',name:'Advisor'});
 assert.equal(requiredExecutionPolicy({workflowId:'advisor',semanticWorkflowSnapshot:previous.definition,agentSnapshots:{analyst:agent}}),undefined);
 const uncommissioned=await launchWorkflowRun(access,{workflowId:'advisor',initialInput:'question',idempotencyKey:'uncommissioned'},f.deps);
 assert.equal(uncommissioned.status,422);
 assert.equal((await uncommissioned.json()).code,'workflow_policy_commissioning_required');
 assert.equal(await f.countRuns(),0);
 const advisor=await f.repo.updateWorkflow({...previous.definition,executionPolicy:'read-only'},previous.fileSha);
 const snapshot=await resolveWorkflowRunSnapshot(access,{kind:'workflow',id:'advisor'},'question','advisor-standalone',f.deps);
 assert.equal(snapshot.executionPolicy,'read-only');
 assert.equal(snapshot.advisorContext,undefined);
 assert.equal(snapshot.workflowRevision,advisor.fileSha);
 assert.equal(snapshot.connectionSnapshots.agents.defaultModel,connection.defaultModel);
 assert.deepEqual(snapshot.agentSnapshots.analyst.tools,agent.tools);
 assert.equal(snapshot.executionPlan.nodes.some(node=>node.blockType==='knowledge-proposal'),false);
 const standard=await f.repo.updateWorkflow({...advisor.definition,executionPolicy:'standard'},advisor.fileSha);
 const standardSnapshot=await resolveWorkflowRunSnapshot(access,{kind:'workflow',id:'advisor'},'question','advisor-standard',f.deps);
 assert.equal(standardSnapshot.executionPolicy,undefined);
 assert.equal(standardSnapshot.workflowRevision,standard.fileSha);
 assert.equal(standardSnapshot.semanticWorkflowSnapshot.executionPolicy,'standard');
 assert.equal(snapshot.executionPolicy,'read-only');
 assert.doesNotThrow(()=>assertRunExecutionPolicy(snapshot));
 const ordinary=await resolveWorkflowRunSnapshot(access,{kind:'workflow',id:workflow.id},'question','ordinary-run',f.deps);
 assert.equal(ordinary.executionPolicy,undefined);
 const single=await resolveWorkflowRunSnapshot(access,{kind:'agent',id:agent.id},'question','single-agent',f.deps);
 assert.equal(single.agentRevisions[agent.id],(await f.repo.getAgent(agent.id)).fileSha);
 assert.deepEqual(single.executionPlan.nodes,[{id:'respond',blockType:'agent',blockVersion:1,config:{agentId:agent.id}}]);
});

test('read-only policy applies to explicitly protected Agents and reachable Workflow definitions',async()=>{
 const f=await fixture(),stored=await f.repo.getAgent(agent.id);
 const protectedAgent=await f.repo.updateAgent({...stored.definition,executionPolicy:'read-only'},stored.fileSha);
 const targetingAgent=await resolveWorkflowRunSnapshot(access,{kind:'agent',id:agent.id},'question','protected-agent',f.deps);
 assert.equal(targetingAgent.executionPolicy,'read-only');
 const saved=await f.repo.getWorkflow(workflow.id);
 await f.repo.updateWorkflow({...saved.definition,executionPolicy:'standard'},saved.fileSha);
 const inherited=await resolveWorkflowRunSnapshot(access,{kind:'workflow',id:workflow.id},'question','protected-workflow',f.deps);
 assert.equal(inherited.executionPolicy,'read-only');
 await f.repo.updateAgent({...protectedAgent.definition,tools:['artifact_search']},protectedAgent.fileSha);
 for(const target of [{kind:'agent',id:agent.id},{kind:'workflow',id:workflow.id}]){
  await assert.rejects(resolveWorkflowRunSnapshot(access,target,'question','protected',f.deps),/execution_read_only_required/);
 }
});
test('read-only admission expands reusable workflows and blocks indirect MCP, Codex and publication escalation',()=>{
 const leaf={...workflow,id:'leaf',exposableAsBlock:true},root={...workflow,nodes:[{id:'nested',blockType:'subworkflow',blockVersion:1,config:{workflowId:'leaf'}}]};
 const expanded=composeVersionedWorkflowV2({definition:root,fileSha:'root'},[{definition:root,fileSha:'root'},{definition:leaf,fileSha:'leaf'}]).workflow,plan=compileWorkflowV2ExecutionPlan(expanded,[agent]);
 assertReadOnlyExecution(plan,[agent],[connection]);
 assert.throws(()=>assertReadOnlyExecution(plan,[{...agent,tools:[{type:'mcp',serverId:'mutating',toolName:'execute_workflow'}]}],[connection]),/execution_read_only_required/);
 assert.throws(()=>assertReadOnlyExecution(plan,[agent],[{...connection,adapter:'codex-runner'}]),/execution_read_only_provider/);
 assert.throws(()=>assertReadOnlyExecution({...plan,nodes:[...plan.nodes,{id:'publish',blockType:'publish-github-pr',blockVersion:1,config:{}}]},[agent],[connection]),/execution_read_only_required/);
 const value=run({advisorContext:{version:1,readOnly:true,override:null}});value.mcpToolSnapshots={analyst:[{tool:{name:'mutate'}}]};assert.throws(()=>assertRunExecutionPolicy(value),/advisor_read_only_required/);
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
 const generatedAgent=JSON.parse(await readFile(paths.agentPath,'utf8')),generatedWorkflow=JSON.parse(await readFile(paths.workflowPath,'utf8'));assert.equal(generatedAgent.connectionKey,'agents');assert.equal(generatedWorkflow.nodes[0].config.agentId,generatedAgent.id);assert.equal(generatedWorkflow.nodes[1].blockType,'knowledge-proposal');assert.equal(generatedWorkflow.executionPolicy,'read-only');assert.deepEqual(generatedAgent.tools,[...ADT_DATA_TOOLS,"adt_advisor_knowledge_search"]);assert.equal('masterPrompt' in generatedAgent,false);
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

test('Workflow and Advisor admission reject incompatible effective models before creating or launching a run',async()=>{
 const f=await fixture(),incompatible={...connection,defaultModel:'gpt-6-luna'};
 await f.repo.createWorkflow({...workflow,id:"advisor",executionPolicy:'read-only'});
 f.deps.listWorkflowConnectionDescriptors=async()=>[incompatible];
 f.deps.listWorkflowConnectionIdentityDescriptors=async()=>[incompatible];
 f.deps.getProviderCredentialVault=async()=>assert.fail('Known API requirements must be checked before snapshotting');
 for(const workflowId of [workflow.id,'advisor']){
  const body={workflowId,initialInput:'question',idempotencyKey:crypto.randomUUID()};
  const response=await launchWorkflowRun(access,body,f.deps);
  assert.equal(response.status,422);
  const result=await response.json();
  assert.equal(result.code,'unsupported_model_option');
  assert.match(result.error,/GPT-6 Luna.*reasoning effort None/);
  assert.equal(await f.storage.findRunByIdempotencyKey(body.idempotencyKey),undefined);
 }
 assert.equal(await f.countRuns(),0);
});

test('Workflow admission allows a model when every activation removes its tools',async()=>{
 const f=await fixture(),incompatible={...connection,defaultModel:'gpt-6-luna'};
 f.deps.listWorkflowConnectionDescriptors=async()=>[incompatible];
 const saved=await f.repo.getWorkflow(workflow.id);
 const restricted={...saved.definition,nodes:[{...saved.definition.nodes[0],blockVersion:4,config:{agentId:agent.id,toolRestrictions:{allowlist:[]}}}]};
 const revision=await f.repo.updateWorkflow(restricted,saved.fileSha);
 const body={workflowId:workflow.id,initialInput:'question',idempotencyKey:crypto.randomUUID()};
 const response=await launchWorkflowRun(access,body,f.deps);
 assert.equal(response.status,201,await response.clone().text());
 const {runId}=await response.json(),detail=await f.storage.getRun(runId);
 assert.equal(detail.run.connectionSnapshots.agents.defaultModel,'gpt-6-luna');
 assert.deepEqual(detail.run.executionPlan.nodes[0].config.toolRestrictions.allowlist,[]);
 assert.deepEqual(detail.run.agentSnapshots.analyst.tools,agent.tools);

 const next={...restricted,nodes:[...restricted.nodes,{id:'verify',blockType:'agent',blockVersion:1,config:{agentId:agent.id}}],edges:[{id:'analyse-verify',source:'analyse',target:'verify'}]};
 await f.repo.updateWorkflow(next,revision.fileSha);
 const rejected=await launchWorkflowRun(access,{...body,idempotencyKey:crypto.randomUUID()},f.deps);
 assert.equal(rejected.status,422);
 assert.equal((await rejected.json()).code,'unsupported_model_option');
 assert.equal(await f.countRuns(),1);
});

test('frozen Advisor runs with a historically accepted override remain readable and protected',async t=>{
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
 assert.doesNotThrow(()=>assertRunExecutionPolicy(detail.run));
 assert.equal((await storage.findRunByIdempotencyKey(historical.clientIdempotencyKey)).run.id,historical.id);
 assert.deepEqual(detail.run.advisorContext.override,override);
});
