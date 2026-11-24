import {adtDataArgumentSchemas,isAdtDataTool,type AdtDataTool} from "./adt-data-contract.ts";
import {failureCategories} from "./workflow-adapter.ts";
import {parseWorkflowOrchestrationDiagnostic} from "./workflow-orchestration-diagnostics.ts";
import {assertNoSecrets} from "./artifact-repository.ts";
import {decodeHistoricalRunAgentSnapshot} from "./workflow-d1-storage.ts";
import type {WorkflowD1Database} from "./workflow-d1-storage.ts";
import type {WorkflowDefinitionRepository} from "./workflow-definition-repository.ts";
import type {RunRepositoryContext} from "./workflow-storage.ts";
import {adtRunScope} from "./adt-data-scope.ts";

export type PromptReader=(id:string)=>Promise<{body:string;path:string;revision:string}|undefined>;
const missing={available:false,reason:"not_found"};
const category=(v:unknown)=>(failureCategories as readonly unknown[]).includes(v)?v:null;
const diagnosticMeaning=(v:unknown,retryable:unknown)=>v==="provider_start_ambiguous"||v==="provider_publish_ambiguous"?"ambiguous_external_outcome":v==="provider_timeout"||v==="security_timeout"?"timeout":retryable===1?"retryable_condition":v?"confirmed_failure":"not_recorded";
const enumValue=(v:unknown,allowed:readonly string[])=>typeof v==="string"&&allowed.includes(v)?v:null;
const number=(v:unknown,max=3600000)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=max?v:null;
const json=(v:unknown)=>{try{return JSON.parse(String(v))}catch{return undefined}};
/** Human approval authorises exactly selected text, never configuration. Known secret-like content is omitted, not made safe by regex redaction. */
export function observedText(value:unknown,maxChars:number,offset=0){
 if(typeof value!=="string")return {available:false,reason:"not_recorded"};
 if(value.length>65536)return {available:false,reason:"content_limit"};
 try{assertNoSecrets(value)}catch{return {available:false,reason:"secret_safety_check"}}
 return {available:true,text:value.slice(offset,offset+maxChars),totalChars:value.length,truncated:offset>0||offset+maxChars<value.length,nextOffset:offset+maxChars<value.length?offset+maxChars:null,untrusted:true,safety:"unverified_sensitive_content",disclosure:"exact_call_human_approval_required"};
}
const attemptIdentity=(a:Record<string,unknown>)=>({stepId:a.step_id,agentId:a.agent_id,activationId:a.graph_activation_id??null,iteration:a.iteration,attempt:a.attempt,status:a.status});

/** External payloads have no trusted disclosure schema, so they are entirely omitted.
 * Native arguments are revalidated; only fixed target/selection fields and result metadata survive. */
function invocationPayload(tool:unknown,argumentsJson:unknown,resultJson:unknown){
 const omitted={available:false,reason:"cannot_establish_safe_disclosure"};
 if(typeof tool!=="string"||!isAdtDataTool(tool))return {arguments:omitted,result:omitted};
 const args=adtDataArgumentSchemas[tool].safeParse(json(argumentsJson));
 const arguments_=args.success?Object.fromEntries(Object.entries(args.data).filter(([key])=>["runId","workflowId","agentId","stepId","iteration","attempt","offset","limit","selection","includePayload","invocationId","maxChars","id","type","status"].includes(key))):omitted;
 const result=json(resultJson),summary:Record<string,unknown>={};
 if(result&&typeof result==="object"&&!Array.isArray(result)){
  for(const key of ["ok","denied"])if(typeof result[key]==="boolean")summary[key]=result[key];
  if(result.result&&typeof result.result==="object"&&!Array.isArray(result.result)){
   const data:Record<string,unknown>={};for(const key of ["available","truncated"])if(typeof result.result[key]==="boolean")data[key]=result.result[key];
   for(const key of ["sampleSize","durationSampleSize","retries","meanCompletedDurationMs","nextOffset"])if(number(result.result[key],1_000_000_000_000)!==null)data[key]=result.result[key];
   summary.metadata=data;
  }
 }
 return {arguments:arguments_,result:summary,omitted:["free_text","arbitrary_fields","result_content"],untrusted:true};
}
export class AdtObservability{
 private db:WorkflowD1Database;private definitions:Pick<WorkflowDefinitionRepository,"getAgent">;private promptReader?:PromptReader;
 constructor(db:WorkflowD1Database,definitions:Pick<WorkflowDefinitionRepository,"getAgent">,promptReader?:PromptReader){this.db=db;this.definitions=definitions;this.promptReader=promptReader}
 async execute(name:AdtDataTool,input:unknown,context:RunRepositoryContext):Promise<unknown>{
  if(name==="adt_agent_prompt_read"){
   const {agentId,runId,offset=0,maxChars=4000}=adtDataArgumentSchemas[name].parse(input);
   if(!runId){
    const current=await this.definitions.getAgent(agentId);if(!current)return missing;
    const {definition:agent,fileSha}=current;
    if(agent.prompt.source==="custom")return {available:true,agentId,source:"current_git",path:current.sourcePath??`agents/${agentId}.agent.json`,revision:fileSha,prompt:observedText(agent.prompt.text,maxChars,offset)};
    const artifact=await this.promptReader?.(agent.prompt.artifactId);
    return {available:true,agentId,source:"current_git",path:current.sourcePath??`agents/${agentId}.agent.json`,revision:fileSha,artifactId:agent.prompt.artifactId,artifactPath:artifact?.path??null,artifactRevision:artifact?.revision??null,prompt:artifact?observedText(artifact.body,maxChars,offset):{available:false,reason:"prompt_artifact_unavailable"}};
   }
   const where=adtRunScope(context,{},this.db.dialect),row=await this.db.prepare(`SELECT r.workflow_id,r.workflow_revision,${this.db.dialect==="postgres"?"(r.agent_snapshots_json->?::text)":"json_extract(CASE WHEN json_valid(r.agent_snapshots_json) THEN r.agent_snapshots_json ELSE '{}' END,?)"} AS agent_json,${this.db.dialect==="postgres"?"(r.agent_revisions_json->>?::text)":"json_extract(CASE WHEN json_valid(r.agent_revisions_json) THEN r.agent_revisions_json ELSE '{}' END,?)"} AS revision FROM workflow_runs r WHERE ${where.sql} AND r.id=?`).bind(...Array<string>(2).fill(this.db.dialect==="postgres"?agentId:`$."${agentId}"`),...where.values,runId).first<Record<string,unknown>>();
   if(!row)return missing;let agent;try{agent=decodeHistoricalRunAgentSnapshot(json(row.agent_json))}catch{return {available:false,reason:"historical_prompt_unavailable"}}
   if(agent.id!==agentId)return {available:false,reason:"historical_prompt_unavailable"};
   return {available:true,agentId,runId,workflowId:row.workflow_id,workflowRevision:row.workflow_revision,revision:row.revision??null,source:"frozen_execution",artifactRevision:"not_recorded",prompt:observedText(agent.masterPrompt,maxChars,offset)};
  }
  if(name==="adt_execution_content_read"){
   const {runId,selection,stepId,iteration,attempt,offset=0,limit=10,maxChars=2000}=adtDataArgumentSchemas[name].parse(input),where=adtRunScope(context,{},this.db.dialect);
   const row=await this.db.prepare(`SELECT r.workflow_id,r.workflow_revision,substr(r.initial_input,1,65537) AS input,substr(r.final_output,1,65537) AS output FROM workflow_runs r WHERE ${where.sql} AND r.id=?`).bind(...where.values,runId).first<Record<string,unknown>>();
   if(!row)return missing;
   if(selection!=="steps")return {available:true,runId,workflowId:row.workflow_id,workflowRevision:row.workflow_revision,kind:selection,content:observedText(selection==="input"?row.input:row.output,maxChars,offset)};
   let filter="";const values:unknown[]=[];
   for(const [key,value] of [["step_id",stepId],["iteration",iteration],["attempt",attempt]] as const)if(value!==undefined){filter+=` AND a.${key}=?`;values.push(value)}
   const rows=(await this.db.prepare(`SELECT a.step_id,a.agent_id,a.graph_activation_id,a.iteration,a.attempt,a.status,substr(a.input_text,1,65537) AS input,substr(a.output_text,1,65537) AS output FROM workflow_step_attempts a JOIN workflow_runs r ON r.id=a.run_id WHERE ${where.sql} AND r.id=?${filter} ORDER BY a.step_id,a.iteration,a.attempt LIMIT ? OFFSET ?`).bind(...where.values,runId,...values,limit+1,offset).all<Record<string,unknown>>()).results??[];
   const bound=Math.min(maxChars,Math.floor(12000/limit));
   return {available:true,runId,workflowId:row.workflow_id,workflowRevision:row.workflow_revision,kind:"intermediate_steps",results:rows.slice(0,limit).map(a=>({...attemptIdentity(a),input:observedText(a.input,bound),output:observedText(a.output,bound)})),nextOffset:rows.length>limit?offset+limit:null,untrusted:true};
  }
  if(name==="adt_execution_errors_read"){
   const {runId,stepId,offset=0,limit=10}=adtDataArgumentSchemas[name].parse(input),where=adtRunScope(context,{},this.db.dialect),row=await this.db.prepare(`SELECT r.workflow_id,r.failure_code,r.orchestration_diagnostics_json FROM workflow_runs r WHERE ${where.sql} AND r.id=?`).bind(...where.values,runId).first<Record<string,unknown>>();if(!row)return missing;
   const rows=(await this.db.prepare(`SELECT a.step_id,a.agent_id,a.graph_activation_id,a.iteration,a.attempt,a.status,a.failure_category,a.retryable,a.started_at,a.completed_at,a.provider_poll_count,a.provider_http_status,a.provider_elapsed_ms,a.provider_transport_outcome,a.provider_transport_reason,a.provider_runtime_error_name FROM workflow_step_attempts a JOIN workflow_runs r ON r.id=a.run_id WHERE ${where.sql} AND r.id=?${stepId?" AND a.step_id=?":""} ORDER BY a.step_id,a.iteration,a.attempt LIMIT ? OFFSET ?`).bind(...where.values,runId,...(stepId?[stepId]:[]),limit+1,offset).all<Record<string,unknown>>()).results??[];
   const d=parseWorkflowOrchestrationDiagnostic(json(row.orchestration_diagnostics_json));
   return {available:true,runId,workflowId:row.workflow_id,failureCategory:category(row.failure_code),meaning:diagnosticMeaning(category(row.failure_code),null),orchestration:d?{stage:d.stage,category:d.category,code:d.orchestrationCode,runtimeCode:d.runtimeCode??null,observedAt:d.observedAt,consecutiveFailures:d.consecutiveFailures,recoveryRetriesAllowed:d.recoveryRetriesAllowed,transport:d.runtimeTransport?{outcome:d.runtimeTransport.outcome,httpStatus:d.runtimeTransport.httpStatus??null,elapsedMs:d.runtimeTransport.elapsedMs}:null}:null,results:rows.slice(0,limit).map(a=>({...attemptIdentity(a),category:category(a.failure_category),meaning:diagnosticMeaning(category(a.failure_category),a.retryable),retryable:a.retryable===null?null:a.retryable===1,startedAt:a.started_at,completedAt:a.completed_at,providerPollCount:number(a.provider_poll_count),provider:{operation:"recorded_step_attempt",httpStatus:number(a.provider_http_status,599),elapsedMs:number(a.provider_elapsed_ms),outcome:enumValue(a.provider_transport_outcome,["response_received","timeout","network_error"]),reason:enumValue(a.provider_transport_reason,["cross_request_io","platform_subrequest_limit","invalid_request_context","network_connection_lost","aborted","fetch_type_error","unknown"]),errorName:enumValue(a.provider_runtime_error_name,["TypeError","AbortError","Error"])}})),nextOffset:rows.length>limit?offset+limit:null,omitted:["raw_errors","failure_messages","provider_payloads","private_urls","request_ids"]};
  }
  if(name==="adt_tool_execution_read"){
   const {runId,stepId,invocationId,includePayload=false,offset=0,limit=10}=adtDataArgumentSchemas[name].parse(input),where=adtRunScope(context,{},this.db.dialect);
   const run=await this.db.prepare(`SELECT r.workflow_id FROM workflow_runs r WHERE ${where.sql} AND r.id=?`).bind(...where.values,runId).first<Record<string,unknown>>();if(!run)return missing;
   const rows=(await this.db.prepare(`SELECT i.id,i.tool_key,i.state,i.created_at,i.admitted_at,i.completed_at,i.admission_id,i.execution_deadline_at,i.security_json,${this.db.dialect==="postgres"?"i.result_json->>'code'":"CASE WHEN json_valid(i.result_json) THEN json_extract(i.result_json,'$.code') END"} AS result_code,${includePayload?(this.db.dialect==="postgres"?"substr(i.arguments_json::text,1,8001) AS arguments_json,substr(i.result_json::text,1,8001) AS result_json,":"substr(i.arguments_json,1,8001) AS arguments_json,substr(i.result_json,1,8001) AS result_json,"):""}s.agent_id,c.id AS continuation_id,c.node_id,c.activation_id,c.generation,c.iteration,c.attempt,a.status AS approval_status,a.decided_at,a.expires_at FROM agent_tool_invocations i JOIN agent_continuations c ON c.id=i.continuation_id JOIN workflow_runs r ON r.id=c.run_id LEFT JOIN workflow_step_attempts s ON s.run_id=c.run_id AND s.step_id=c.node_id AND s.iteration=c.iteration AND s.attempt=c.attempt LEFT JOIN agent_tool_approvals a ON a.invocation_id=i.id WHERE ${where.sql} AND r.id=?${stepId?" AND c.node_id=?":""}${invocationId?" AND i.id=?":""} ORDER BY i.created_at,i.id LIMIT ? OFFSET ?`).bind(...where.values,runId,...(stepId?[stepId]:[]),...(invocationId?[invocationId]:[]),limit+1,offset).all<Record<string,unknown>>()).results??[];
   return {available:true,runId,workflowId:run.workflow_id,results:rows.slice(0,limit).map(i=>{const s=json(i.security_json);return {invocationId:i.id,continuationId:i.continuation_id,stepId:i.node_id,agentId:i.agent_id??null,activationId:i.activation_id,generation:i.generation,iteration:i.iteration,attempt:i.attempt,tool:i.tool_key,state:i.state,ambiguous:i.state==="unknown",createdAt:i.created_at,admittedAt:i.admitted_at,admissionId:i.admission_id,executionDeadlineAt:i.execution_deadline_at,completedAt:i.completed_at,approval:{status:i.approval_status??"not_required",decidedAt:i.decided_at??null,expiresAt:i.expires_at??null},diagnosticCode:enumValue(i.result_code,["policy_denied","human_rejected","approval_expired","tool_authority_changed","mandatory_security_or_authority_unavailable","approver_authority_revoked","reviewer_authority_revoked","no_authorized_reviewer","security_denied","security_timeout","security_unavailable","tool_execution_failed"]),security:enumValue(s?.outcome,["allow","deny","timeout","unavailable","not_configured"]),...(includePayload?{payload:{...invocationPayload(i.tool_key,i.arguments_json,i.result_json),truncated:String(i.arguments_json).length>8000||String(i.result_json).length>8000}}:{})}}),nextOffset:rows.length>limit?offset+limit:null,untrusted:true};
  }
  throw Error("adt_data_tool_invalid");
 }
}
