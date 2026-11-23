import assert from 'node:assert/strict';
import {AdtDataTools} from '../../lib/adt-data-tools.ts';
import {ADT_DATA_TOOLS} from '../../lib/adt-data-contract.ts';
import {executeJournaledWorkflowAgent} from '../../lib/workflow-agent-execution.ts';
import {D1WorkflowRunStorage} from '../../lib/workflow-d1-storage.ts';
import {InMemoryWorkflowDefinitionRepository} from '../../lib/workflow-definition-repository.ts';
import {AgentJournal,agentDigest} from '../../lib/agent-journal.ts';
import {context,connection,agent,workflow,run,database} from './advisor-fixtures.mjs';

export async function nativeFixture(t,{tool='adt_workflow_read',arguments:args={workflowId:'review'},advisor=true,tools=[...ADT_DATA_TOOLS],approval,provider='openai-agents',model,remote,adapterOptions,executionLimits,knowledgeReader,db:providedDb}={}){
 const db=providedDb??await database(t),storage=new D1WorkflowRunStorage(db),repo=new InMemoryWorkflowDefinitionRepository();await repo.createAgent(agent);await repo.createWorkflow(workflow);
 const descriptor={...connection,adapter:provider,...(provider==='ollama-chat'?{providerConfiguration:{baseUrl:'http://ollama:11434',authMode:'none'},credentialSecretRef:undefined,credentialSource:undefined}:{}),defaultModel:model??(provider==='anthropic-messages'?'claude-sonnet-4-5':provider==='ollama-chat'?'qwen3':'gpt-5')},selected={...agent,tools,...(adapterOptions?{adapterOptions}:{}),...(executionLimits?{executionLimits}:{}),...(approval?{toolApproval:approval}:{})},value=run({agents:[selected],connections:[descriptor],...(advisor?{advisorContext:{version:1,readOnly:true,override:null}}:{})});await storage.createRun(value);
 const scope={runId:value.id,workflowGeneration:1,nodeId:'analyse',activationId:'activation',iteration:1,attempt:1};await storage.ensureGraphActivation(value.id,'analyse','activation');
 const data=new AdtDataTools(db,repo,knowledgeReader);let models=0,reads=0,authorizations=0,lastEvidence;
 const nativeData={authorize:async frozen=>{assert.deepEqual(frozen,context);authorizations++},execute:async(name,input,frozen)=>{reads++;assert.deepEqual(frozen,context);return data.execute(name,input,frozen)}};
 const runtime=remote??{agentOperation:async(path,payload)=>{assert.equal(path,'/v1/agents/progress');models++;if(models===1)return{version:1,text:'',calls:[{id:'provider-call',name:tool,arguments:args}],usage:{inputTokens:12,outputTokens:3}};lastEvidence=JSON.parse(payload.request.conversation.at(-1).text);return{version:1,text:lastEvidence.ok?`Analysis grounded in ${lastEvidence.result.id??lastEvidence.result.results?.[0]?.id??'recorded metrics'}`:'Insufficient authorised data',calls:[],usage:{inputTokens:20,outputTokens:5}}}};
 const base={env:{AUTH_SESSIONS_DB:db,ADT_TOOL_APPROVERS:'reviewer',WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY:Buffer.alloc(32).toString('base64')},scope,inputText:'Analyse weaknesses in review',storage,configuration:{},runtime,nativeData,resolveConnection:async(key,snapshot)=>({...snapshot,...(provider==='ollama-chat'?{}:{credential:'SENSITIVE_PROVIDER'})})};
 async function step(){const detail=await storage.getRun(value.id),attempt=detail.attempts.at(-1);return executeJournaledWorkflowAgent({...base,detail,attempt,agent:detail.run.agentSnapshots[agent.id]})}
 const journal=new AgentJournal(db,undefined,{ADT_TOOL_APPROVERS:'reviewer'}),id=agentDigest([scope.runId,1,'analyse','activation',1,1]);
 return{db,storage,repo,value,scope,data,nativeData,base,journal,id,step,get reads(){return reads},get models(){return models},get authorizations(){return authorizations},get lastEvidence(){return lastEvidence},async finish(){let result;for(let i=0;i<12;i++){result=await step();if(result.state!=='pending')return result}assert.fail('Journal did not finish')}};
}
