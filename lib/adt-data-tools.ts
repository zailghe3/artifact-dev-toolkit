import {openAIMaxOutputTokens,openAIReasoningEfforts,openAIVerbosities} from "../adt-runtime/src/openai-model-policy.ts";
import {adtRunScope} from "./adt-data-scope.ts";
import {AdtObservability,type PromptReader} from "./adt-observability.ts";
import type {KnowledgeReader} from "./advisor-knowledge-repository.ts";
import {adtDataArgumentSchemas,type AdtDataTool} from "./adt-data-contract.ts";
import {sameRepositoryContext} from "./advisor-policy.ts";
import {failureCategories} from "./workflow-adapter.ts";
import {parseWorkflowOrchestrationDiagnostic} from "./workflow-orchestration-diagnostics.ts";
import type {WorkflowDefinitionRepository} from "./workflow-definition-repository.ts";
import type {WorkflowD1Database} from "./workflow-d1-storage.ts";
import type {RunRepositoryContext} from "./workflow-storage.ts";

const duration=(start:unknown,end:unknown)=>typeof start==="string"&&typeof end==="string"&&Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end))?Math.max(0,Date.parse(end)-Date.parse(start)):null;
const safeCategory=(value:unknown)=>(failureCategories as readonly unknown[]).includes(value)?value:null;
function safeAgentOptions(value:unknown){
  const options=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{},result:Record<string,unknown>={};
  if(typeof options.reasoningEffort==="string"&&openAIReasoningEfforts.some(value=>value===options.reasoningEffort))result.reasoningEffort=options.reasoningEffort;
  if(typeof options.verbosity==="string"&&openAIVerbosities.some(value=>value===options.verbosity))result.verbosity=options.verbosity;
  for(const [key,max] of [["maxOutputTokens",openAIMaxOutputTokens],["executionTimeoutSeconds",900]] as const)if(Number.isSafeInteger(options[key])&&Number(options[key])>0&&Number(options[key])<=max)result[key]=options[key];
  if(typeof options.managedGit==="boolean")result.managedGit=options.managedGit;
  return result;
}
const columns="r.id,r.workflow_id,r.workflow_revision,r.status,r.created_at,r.started_at,r.completed_at,r.updated_at,r.transition_count,r.failure_code";
const metadata=(row:Record<string,unknown>)=>({id:row.id,workflowId:row.workflow_id,workflowRevision:row.workflow_revision,status:row.status,createdAt:row.created_at,startedAt:row.started_at??null,completedAt:row.completed_at??null,updatedAt:row.updated_at,durationMs:duration(row.started_at,row.completed_at),failureCategory:safeCategory(row.failure_code)});

/** No caller-supplied SQL or repository identity. Queries project metadata before any response is built. */
export class AdtDataTools {
  private db:WorkflowD1Database;
  private definitions:Pick<WorkflowDefinitionRepository,"listWorkflows"|"getWorkflow"|"getAgent">;
  private knowledge?:KnowledgeReader;private promptReader?:PromptReader;
  constructor(db:WorkflowD1Database,definitions:Pick<WorkflowDefinitionRepository,"listWorkflows"|"getWorkflow"|"getAgent">,knowledge?:KnowledgeReader,promptReader?:PromptReader){this.db=db;this.definitions=definitions;this.knowledge=knowledge;this.promptReader=promptReader}
  async execute(name:AdtDataTool,input:unknown,context:RunRepositoryContext):Promise<unknown>{
    if(name==="adt_advisor_knowledge_search"){
      const query=adtDataArgumentSchemas[name].parse(input);
      if(!this.knowledge)return {available:false,reason:"knowledge_unavailable"};
      try{return await this.knowledge.search(query)}catch(error){return {available:false,reason:error instanceof Error&&error.message==="knowledge_library_limit"?"knowledge_library_limit":"knowledge_unavailable"};}
    }
    if(["adt_agent_prompt_read","adt_execution_content_read","adt_execution_errors_read","adt_tool_execution_read"].includes(name))return new AdtObservability(this.db,this.definitions,this.promptReader).execute(name,input,context);
    switch(name){
      case "adt_workflows_list":{
        const {offset=0,limit=10,query=""}=adtDataArgumentSchemas[name].parse(input);
        const all=(await this.definitions.listWorkflows()).filter(item=>`${item.definition.id} ${item.definition.name}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>a.definition.id.localeCompare(b.definition.id));
        const results=all.slice(offset,offset+limit).map(({definition,fileSha})=>({id:definition.id,name:definition.name,revision:fileSha,nodeCount:definition.nodes.length,executionLimit:definition.limits.maxStepExecutions}));
        return {results,nextOffset:offset+limit<all.length?offset+limit:null};
      }
      case "adt_workflow_read":{
        const {workflowId}=adtDataArgumentSchemas[name].parse(input),item=await this.definitions.getWorkflow(workflowId);
        if(!item)return {available:false,reason:"not_found"};
        const definition=item.definition,agentIds=[...new Set(definition.nodes.filter(node=>node.blockType==="agent").map(node=>(node.config as {agentId:string}).agentId))];
        const agents=await Promise.all(agentIds.map(async id=>{
          const agent=(await this.definitions.getAgent(id))?.definition;
          if(!agent)return {id,available:false};
          return {id:agent.id,name:agent.name,connectionKey:agent.connectionKey,securityProfileId:agent.securityProfileId??null,tools:agent.tools??[],toolApproval:agent.toolApproval??"risk_based",executionLimits:agent.executionLimits??{},options:safeAgentOptions(agent.adapterOptions),prompt:"unavailable:sensitive_content"};
        }));
        // Only structural references and boolean context flags cross the model boundary.
        const nodes=definition.nodes.map(node=>{const config=node.config as Record<string,unknown>;return {id:node.id,blockType:node.blockType,blockVersion:node.blockVersion,...(node.blockType==="agent"?{agentId:config.agentId,context:config.context,conversation:config.conversation,toolRestrictions:config.toolRestrictions}:node.blockType==="subworkflow"?{workflowId:config.workflowId}:node.blockType==="condition"?{operator:config.operator,caseSensitive:config.caseSensitive}:{})}});
        return {available:true,id:definition.id,name:definition.name,revision:item.fileSha,nodes,edges:definition.edges,limits:definition.limits,agents,excluded:["prompts","starter_input","condition_text","approval_text","publication_content","credentials"]};
      }
      case "adt_executions_list":{
        const {offset=0,limit=10,...filters}=adtDataArgumentSchemas[name].parse(input),where=adtRunScope(context,filters);
        const rows=(await this.db.prepare(`SELECT ${columns} FROM workflow_runs r WHERE ${where.sql} ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?`).bind(...where.values,limit+1,offset).all<Record<string,unknown>>()).results??[];
        return {results:rows.slice(0,limit).map(metadata),nextOffset:rows.length>limit?offset+limit:null,content:"unavailable:sensitive_content"};
      }
      case "adt_execution_read":{
        const {runId,offset=0,limit=10}=adtDataArgumentSchemas[name].parse(input),where=adtRunScope(context);
        const row=await this.db.prepare(`SELECT ${columns},r.orchestration_diagnostics_json FROM workflow_runs r WHERE ${where.sql} AND r.id=?`).bind(...where.values,runId).first<Record<string,unknown>>();
        if(!row)return {available:false,reason:"not_found"};
        const attempts=(await this.db.prepare(`SELECT a.step_id,a.iteration,a.attempt,a.agent_id,a.connection_key,a.status,a.started_at,a.completed_at,a.failure_category,a.retryable,a.provider_poll_count FROM workflow_step_attempts a JOIN workflow_runs r ON r.id=a.run_id WHERE ${where.sql} AND r.id=? ORDER BY a.iteration,a.rowid,a.attempt LIMIT ? OFFSET ?`).bind(...where.values,runId,limit+1,offset).all<Record<string,unknown>>()).results??[];
        const journal=(await this.db.prepare(`SELECT c.node_id,c.iteration,c.attempt,c.state,c.provider,c.model,c.model_turns,c.tool_executions,c.tokens_used,c.active_ms FROM agent_continuations c JOIN workflow_runs r ON r.id=c.run_id WHERE ${where.sql} AND r.id=? ORDER BY c.node_id,c.iteration,c.attempt LIMIT ? OFFSET ?`).bind(...where.values,runId,limit+1,offset).all<Record<string,unknown>>()).results??[];
        let diagnostic;try{diagnostic=parseWorkflowOrchestrationDiagnostic(JSON.parse(String(row.orchestration_diagnostics_json)))}catch{}
        return {available:true,...metadata(row),transitions:row.transition_count,attempts:attempts.slice(0,limit).map(a=>({stepId:a.step_id,agentId:a.agent_id,connectionKey:a.connection_key,iteration:a.iteration,attempt:a.attempt,status:a.status,startedAt:a.started_at??null,completedAt:a.completed_at??null,durationMs:duration(a.started_at,a.completed_at),failureCategory:safeCategory(a.failure_category),retryable:a.retryable===null?null:Boolean(a.retryable),providerPollCount:a.provider_poll_count})),nextOffset:attempts.length>limit?offset+limit:null,agentProgress:journal.slice(0,limit).map(c=>({nodeId:c.node_id,iteration:c.iteration,attempt:c.attempt,state:c.state,provider:c.provider,model:c.model,modelTurns:c.model_turns,toolExecutions:c.tool_executions,reportedTokens:c.tokens_used,activeMs:c.active_ms})),agentProgressNextOffset:journal.length>limit?offset+limit:null,diagnostic:diagnostic?{stage:diagnostic.stage,category:diagnostic.category,code:diagnostic.orchestrationCode,consecutiveFailures:diagnostic.consecutiveFailures,observedAt:diagnostic.observedAt}:null,content:"unavailable:sensitive_content"};
      }
      case "adt_execution_metrics":{
        const filters=adtDataArgumentSchemas[name].parse(input),where=adtRunScope(context,filters);
        const rows=(await this.db.prepare(`SELECT ${columns},(SELECT count(*) FROM workflow_step_attempts a WHERE a.run_id=r.id AND a.attempt>1) AS retries,(SELECT count(*) FROM agent_continuations c WHERE c.run_id=r.id) AS journaled_activations,(SELECT COALESCE(sum(c.tokens_used),0) FROM agent_continuations c WHERE c.run_id=r.id) AS reported_tokens FROM workflow_runs r WHERE ${where.sql} ORDER BY r.created_at DESC,r.id DESC LIMIT 1001`).bind(...where.values).all<Record<string,unknown>>()).results??[],sample=rows.slice(0,1000),durations=sample.map(row=>duration(row.started_at,row.completed_at)).filter((value):value is number=>value!==null);
        return {sampleSize:sample.length,truncated:rows.length>1000,sampleOrder:"newest_first",statuses:Object.fromEntries(["queued","running","waiting_approval","cancelling","succeeded","failed","cancelled"].map(status=>[status,sample.filter(row=>row.status===status).length])),meanCompletedDurationMs:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null,durationSampleSize:durations.length,retries:sample.reduce((sum,row)=>sum+Number(row.retries),0),tokens:{available:sample.some(row=>Number(row.journaled_activations)>0),recordedTotal:sample.reduce((sum,row)=>sum+Number(row.reported_tokens),0),coverage:"journaled_provider_reports_only",zeroMayMeanUnreported:true},cost:{available:false,reason:"not_recorded"}};
      }
    }
  }
}

export {sameRepositoryContext};
