import type {McpAdmissionAuthority} from "./mcp-policy-authority.ts";
import {hasToolRole} from "./agent-tool-roles.ts";
import {RemoteRuntimeFailure} from "./adt-runtime-client.ts";
import {AgentJournal,agentDigest,type ToolInvocation} from "./agent-journal.ts";
import {approvalPolicySchema,blockToolsSchema,conversationSchema,evaluateToolPolicy,modelProgressResultSchema,narrowLimits,validateToolArguments,type ApprovalPolicy,type Conversation,type ModelProgress,type ToolProposal} from "../adt-runtime/src/agent-contract.ts";
import type {AgentDefinitionV1} from "./workflow-definitions.ts";
export type AgentTool={key:string;alias:string;description:string;schema:Record<string,unknown>;target:string;policy:ApprovalPolicy;frozen:unknown};
export type AgentExecutionDependencies={journal:AgentJournal;id:string;runId:string;generation:number;nodeId:string;activationId:string;iteration:number;attempt:number;agent:AgentDefinitionV1;provider:ModelProgress["provider"];model:string;input:string;configuration?:Record<string,string>;timeoutMs:number;restrictions?:unknown;tools:AgentTool[];initialize:boolean;admissionAuthority?:(tool:AgentTool)=>McpAdmissionAuthority|undefined;progress:(request:ModelProgress)=>Promise<unknown>;authorize:(tool:AgentTool,call:ToolProposal)=>Promise<ApprovalPolicy[]>;security:(conversation:Conversation,call:ToolProposal,identity:string)=>Promise<unknown>;execute:(tool:AgentTool,call:ToolInvocation,admissionId:string)=>Promise<unknown>};
export type AgentProgressOutcome={state:"pending"|"completed"|"failed";outputText?:string;safeMessage?:string;category?:"provider_start_ambiguous"|"provider_rejected";waiting?:boolean};
const denial=(reason:string)=>({ok:false,denied:true,code:reason});
export async function progressDurableAgent(input:AgentExecutionDependencies):Promise<AgentProgressOutcome>{
 const {journal,id}=input,restrictions=blockToolsSchema.parse(input.restrictions??{}),limits=narrowLimits(input.agent.executionLimits,restrictions.limits),tools=input.tools.filter(tool=>restrictions.allowlist===undefined||restrictions.allowlist.includes(tool.key));
 if(restrictions.allowlist?.some(key=>!input.tools.some(tool=>tool.key===key)))throw Error("workflow_tool_expansion");
 let c=await journal.get(id);
 if(!c){if(!input.initialize)throw Error("historical_agent_requires_cutover");c=await journal.create({id,runId:input.runId,generation:input.generation,nodeId:input.nodeId,activationId:input.activationId,iteration:input.iteration,attempt:input.attempt,provider:input.provider,model:input.model,input:input.input,toolResultBytes:limits.toolResultBytes})}
 const conversation=()=>conversationSchema.parse(JSON.parse(c!.conversation_json));
 const fail=async(reason:string,category:"provider_start_ambiguous"|"provider_rejected"="provider_rejected"):Promise<AgentProgressOutcome>=>{if(!await journal.transition(c!,c!.state,"failed"))return{state:"pending"};await journal.event(id,"failure",undefined,{reason});return{state:"failed",safeMessage:reason,category}};
 const pending=(waiting=false):AgentProgressOutcome=>({state:"pending",waiting});
 if(c.state==="failed"||c.state==="cancelled")return{state:"failed",safeMessage:"Agent activation is terminal."};
 if(c.state==="completed"){const last=conversation().at(-1);if(last?.role!=="assistant"||last.calls.length)throw Error("agent_final_state_invalid");return{state:"completed",outputText:last.text}}
 if(c.state==="model_running"){if(journal.now()-(c.operation_started_at??0)>input.timeoutMs+30000)return fail("The model request outcome is uncertain; ADT did not repeat it.","provider_start_ambiguous");return pending()}

 if(c.state==="ready"){
  if(c.tokens_used>=limits.totalTokens)return fail("The Agent aggregate token budget was reached.");
  if(c.active_ms>=limits.activeMs)return fail("The Agent active execution budget was reached.");
  if(c.model_turns>=limits.modelTurns)return fail("The Agent model turn budget was reached.");
  if(!await journal.claimModel(c,limits.modelTurns,limits.activeMs))return pending();c=(await journal.get(id))!;
  try{
   const result=modelProgressResultSchema.parse(await input.progress({version:1,provider:input.provider,model:input.model,instructions:input.agent.masterPrompt,conversation:conversation(),turn:c.model_turns,tools:tools.map(tool=>({name:tool.alias,description:tool.description,schema:tool.schema})),options:{...providerOptions(input.agent.adapterOptions),maxOutputTokens:Math.min(providerOptions(input.agent.adapterOptions).maxOutputTokens??4096,limits.totalTokens-c.tokens_used)},timeoutMs:Math.max(1000,Math.min(input.timeoutMs,limits.activeMs-c.active_ms)),configuration:input.configuration}));
   const priorIds=new Set(conversation().flatMap(turn=>turn.role==="assistant"?turn.calls.map(call=>call.id):[]));if(result.calls.some(call=>priorIds.has(call.id)))throw Error("provider_call_identity_reused");
   const calls=result.calls.map(proposal=>{const tool=tools.find(tool=>tool.alias===proposal.name);if(!tool)throw Error("The model proposed an ungranted tool.");validateToolArguments(tool.schema,proposal.arguments);return{proposal,key:tool.key,frozen:tool.frozen,target:tool.target}});
   if(!await journal.persistResponse(c,result.text,calls,limits.toolProposals,(result.usage?.inputTokens??0)+(result.usage?.outputTokens??0)))return pending();await journal.event(id,"model_response_persisted",undefined,{turn:c.model_turns,calls:calls.length});return pending();
  }catch(error){const ambiguous=!!error&&typeof error==="object"&&(("ambiguous" in error&&error.ambiguous===true)||("category" in error&&error.category==="provider_start_ambiguous"));return fail(error instanceof RemoteRuntimeFailure?error.safeMessage:"The model request failed or returned an invalid proposal. No automatic replay was made.",ambiguous?"provider_start_ambiguous":"provider_rejected")}
 }
 const calls=await journal.calls(id);let call=calls.find(call=>!["completed","denied"].includes(call.state));
 if(!call){const history=conversation(),last=history.at(-1);if(last?.role!=="assistant"||!last.calls.length)throw Error("agent_continuation_invalid");const current=calls.filter(item=>item.turn===c!.model_turns);if(current.some(item=>item.result_json===null))return fail("A completed tool result is unavailable; the Agent did not continue.");const turns=current.map(item=>({role:"tool" as const,callId:item.provider_call_id,name:item.alias,text:item.result_json!,...(item.state==="denied"?{denied:true}:{})}));if(await journal.transition(c,c.state,"ready",[...history,...turns]))await journal.event(id,"resume");return pending()}
 if(call.state==="cancelled")return fail("The uncertain tool invocation was terminated without asserting its external outcome.");
 if(call.state==="admitted"){
  await journal.markUnknown(call,"execution_deadline",true);
  return pending((await journal.call(call.id))?.state==="unknown")
 }
 if(call.state==="unknown"){if(c.state!=="reconciliation")await journal.transition(c,c.state,"reconciliation");return pending(true)}
 if(c.state==="reconciliation"){
  // A reconciliation can establish a result or confirmed non-execution; no timer re-admits work.
  await journal.transition(c,"reconciliation","tools");return pending()
 }
 const tool=tools.find(tool=>tool.key===call!.tool_key&&tool.alias===call!.alias);
 const deny=async(reason:string,security?:unknown)=>{await journal.setCall(call!,call!.state,"denied",denial(reason),security);return pending()};
 if(!tool||agentDigest(tool.frozen)!==agentDigest(JSON.parse(call.frozen_json)))return deny("tool_authority_changed");
 const proposal:ToolProposal={id:call.provider_call_id,name:call.alias,arguments:JSON.parse(call.arguments_json)};
 if(call.state==="waiting"){
  const approval=await journal.expire(call);if(!approval)throw Error("approval_missing");if(approval.status==="pending")return pending(true);
  if(approval.status!=="approved")return deny(approval.status==="rejected"?"human_rejected":"approval_expired");
  if(approval.continuation_revision!==c.revision)throw Error("approval_stale");
  if(!await journal.resumeApproved(c,call))return pending();c=(await journal.get(id))!;call=(await journal.call(call.id))!;
 }
 const decisionStarted=journal.now();
 try{
  validateToolArguments(tool.schema,proposal.arguments);
  const policies=[tool.policy,...await input.authorize(tool,proposal)];
  await journal.event(id,"validation",call.id,{outcome:"allow"});
  const decision=evaluateToolPolicy(policies,proposal.arguments,input.agent.toolApproval==="approval"||restrictions.requireApproval?.includes(tool.key));
  if(decision==="deny")return deny("policy_denied");
  const security=await input.security(conversation(),proposal,call.id);if(!security||typeof security!=="object"||!("outcome" in security)||!["allow","not_configured"].includes(String(security.outcome)))throw Error("security_evidence_invalid");const evidence={...security,approvalDecision:decision,policies};
  await journal.event(id,"security_decision",call.id,{outcome:security.outcome,approvalDecision:decision});
  if(call.state==="proposed"){if(!await journal.setCall(call,"proposed","validated",undefined,evidence))return pending();call=(await journal.call(call.id))!}
  const approval=await journal.approval(call);
  if(decision==="approval"&&approval?.status!=="approved"){
   const groups=policies.map(p=>p.reviewers).filter((p):p is string[]=>Boolean(p?.length));const reviewers=groups.length?groups.reduce((a,b)=>a.filter(v=>b.includes(v))):[];
   if(groups.length&&!reviewers.length)return deny("no_authorized_reviewer");
   await journal.requireApproval(c,call,reviewers,Math.min(...policies.map(p=>p.expirySeconds)),limits.pendingApprovals);return pending(true)
  }
  if(approval&&(approval.expires_at<=journal.now()||approval.created_at+Math.min(...policies.map(policy=>policy.expirySeconds))*1000<=journal.now()))return deny("approval_expired");
  if(approval?.status==="approved"&&!hasToolRole(approval.decided_by??"","approver",journal.environment))return deny("approver_authority_revoked");
  if(approval?.status==="approved"&&policies.some(policy=>policy.reviewers?.length&&!policy.reviewers.includes(approval.decided_by??"")))return deny("reviewer_authority_revoked");
  if(!["validated","eligible"].includes(call.state))return pending();
  if(!await journal.setCall(call,call.state,"eligible",undefined,evidence))return pending();call=(await journal.call(call.id))!;
  if(c.tokens_used>=limits.totalTokens)return fail("The Agent aggregate token budget was reached.");
  if(c.tool_executions>=limits.toolExecutions)return fail("The Agent tool execution budget was reached.");
  if(c.active_ms+journal.now()-decisionStarted>=limits.activeMs)return fail("The Agent active execution budget was reached.");
  if(c.tool_result_bytes>=c.tool_result_limit)return fail("The Agent aggregate tool-result byte budget was reached.");
  const approvalDeadline=approval?Math.min(approval.expires_at,approval.created_at+Math.min(...policies.map(policy=>policy.expirySeconds))*1000):undefined;
  const admissionId=await journal.admit(c,call,limits.toolExecutions,approvalDeadline,input.admissionAuthority?.(tool));if(!admissionId)return pending();await journal.event(id,"execution_admitted",call.id,{admissionId});call=(await journal.call(call.id))!;if(call.state!=="admitted"||call.admission_id!==admissionId)return pending();
  let externalReturned=false;
  try{const result=await input.execute(tool,call,admissionId);externalReturned=true;await journal.finish(call,admissionId,{ok:true,result})}
  catch(error){
   const ambiguous=externalReturned||!!error&&typeof error==="object"&&"ambiguous" in error&&error.ambiguous===true;
   if(ambiguous){await journal.markUnknown(call,externalReturned?"result_persistence":"transport_or_remote_uncertainty",false,error instanceof RemoteRuntimeFailure?{category:error.category}:{});return pending((await journal.call(call.id))?.state==="unknown")}
   await journal.finish(call,admissionId,{ok:false,code:"tool_execution_failed"});
  }

  return pending()
 }catch(error){const category=error&&typeof error==="object"&&"category" in error?String(error.category):"";if(["security_denied","security_timeout","security_unavailable"].includes(category)){const evidence={provider:"adrian",outcome:category.slice(9)};await journal.event(id,"security_decision",call.id,evidence);return deny(category,evidence)}return deny("mandatory_security_or_authority_unavailable")}finally{await journal.db.prepare("UPDATE agent_continuations SET active_ms=active_ms+? WHERE id=?").bind(Math.max(0,Math.min(journal.now(),call.execution_deadline_at??Infinity)-decisionStarted),id).run()}
}
function providerOptions(value:unknown):ModelProgress["options"]{const options=(value??{}) as Record<string,unknown>;return{...(typeof options.maxOutputTokens==="number"?{maxOutputTokens:options.maxOutputTokens}:{}),...(typeof options.reasoningEffort==="string"?{reasoningEffort:options.reasoningEffort}:{}),...(typeof options.verbosity==="string"?{verbosity:options.verbosity}:{})}}
export const defaultToolPolicy=()=>approvalPolicySchema.parse({});
export const builtinSearchTool:AgentTool={key:"artifact_search",alias:"artifact_search",description:"Search the authorised ADT Artifact Library.",schema:{type:"object",properties:{query:{type:"string",minLength:1,maxLength:500},limit:{type:"integer",minimum:1,maximum:10}},required:["query"],additionalProperties:false},target:"authorised Artifact Library",policy:approvalPolicySchema.parse({classification:"read_only"}),frozen:{type:"builtin",name:"artifact_search",version:1}};
