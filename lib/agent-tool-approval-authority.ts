import {evaluateToolPolicy} from "../adt-runtime/src/agent-contract.ts";
import {hasToolRole} from "./agent-tool-roles.ts";
import type {AgentJournal,ToolApproval} from "./agent-journal.ts";
import type {FrozenMcpTool} from "./mcp-tool-authority.ts";
import type {D1McpPolicyAuthority,McpPolicyVault} from "./mcp-policy-authority.ts";
import type {ToolDefinitionRepository} from "./tool-definition-repository.ts";

/** Rejection needs frozen reviewer authority; approval additionally needs live execution authority. */
export async function toolApprovalAuthority(input:{journal:AgentJournal;runId:string;invocationId:string;decision:"approved"|"rejected";actor:string;repositoryId:number;repository:Pick<ToolDefinitionRepository,"get">;policies:D1McpPolicyAuthority;vault:McpPolicyVault}){
 const {journal,actor}=input;
 if(!hasToolRole(actor,"approver",journal.environment))throw Error("permission_denied");
 const call=await journal.call(input.invocationId),c=call&&await journal.get(call.continuation_id);if(!call||!c||c.run_id!==input.runId)throw Error("approval_not_pending");
 const approval=await journal.approval(call);if(!approval)throw Error("approval_not_pending");
 const reviewers=JSON.parse(approval.reviewers_json) as string[];if(reviewers.length&&!reviewers.includes(actor.toLowerCase()))throw Error("permission_denied");
 if(input.decision==="rejected"||call.tool_key==="artifact_search")return undefined;
 const frozen=JSON.parse(call.frozen_json) as FrozenMcpTool,live=await input.repository.get(frozen.serverId);if(!live)throw Error("mcp_policy_unverified");
 const verified=await input.policies.verify(input.repositoryId,live.definition,input.vault);await input.policies.verifyFrozen(input.repositoryId,frozen,verified);
 const policy=verified.policies[frozen.tool.name];
 if(policy&&(policy.reviewers?.length&&!policy.reviewers.includes(actor.toLowerCase())||approval.created_at+policy.expirySeconds*1000<=journal.now()||evaluateToolPolicy([policy],JSON.parse(call.arguments_json))==="deny"))throw Error("permission_denied");
 return verified.guard;
}
export async function approvalInvocation(journal:AgentJournal,runId:string,approvalId:string){const value=await journal.db.prepare("SELECT a.* FROM agent_tool_approvals a JOIN agent_tool_invocations i ON i.id=a.invocation_id JOIN agent_continuations c ON c.id=i.continuation_id WHERE a.id=? AND c.run_id=?").bind(approvalId,runId).first<ToolApproval>();if(!value)throw Error("approval_not_pending");return value.invocation_id}
