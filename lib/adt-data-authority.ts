import {isAdtDataTool,isSensitiveAdtTool,ADT_DATA_TOOL_DESCRIPTIONS,adtDataModelSchemas,type AdtDataTool} from "./adt-data-contract.ts";
import {assertRunExecutionPolicy,sameRepositoryContext} from "./workflow-execution-policy.ts";
import {getProviderConnectionType} from "./provider-connection-types.ts";
import {isLegacyRunReadOnly} from "./workflow-run-legacy.ts";
import {approvalPolicySchema,grantKey} from "../adt-runtime/src/agent-contract.ts";
import type {AgentDefinitionV1} from "./workflow-definitions.ts";
import type {AgentTool} from "./agent-execution.ts";
import type {GraphNodeAuthorityScope} from "./langgraph-checkpoints.ts";
import type {RunDetail,RunRepositoryContext} from "./workflow-storage.ts";

export function nativeAdtToolDefinitions(grants:AgentDefinitionV1["tools"]):AgentTool[]{
  return (grants??[]).map(grantKey).filter(isAdtDataTool).map(name=>({key:name,alias:name,description:ADT_DATA_TOOL_DESCRIPTIONS[name],schema:adtDataModelSchemas[name],target:"authorised ADT repository",policy:approvalPolicySchema.parse(isSensitiveAdtTool(name)?{classification:"sensitive",minimum:"approval"}:{classification:"read_only"}),frozen:{type:"builtin",name,version:1}}));
}

/** Invoked after approval/security waits and immediately before a journal-admitted data read. */
export function authorizeNativeAdtTool(detail:RunDetail|undefined,scope:GraphNodeAuthorityScope,name:AdtDataTool,frozenContext:RunRepositoryContext|undefined){
  if(!detail||isLegacyRunReadOnly(detail.run)||detail.run.workflowGeneration!==scope.workflowGeneration||detail.run.status!=="running"||detail.run.cancelRequestedAt||detail.run.failureCode||!sameRepositoryContext(detail.run.repositoryContext,frozenContext))throw new Error("adt_data_authority_invalid");
  assertRunExecutionPolicy(detail.run);
  const plan=detail.run.executionPlan,node=plan&&"planVersion" in plan?plan.nodes.find(node=>node.id===scope.nodeId):undefined;
  const attempt=detail.attempts.filter(a=>a.stepId===scope.nodeId).sort((a,b)=>a.iteration-b.iteration||a.attempt-b.attempt).at(-1);
  const agent=node?.blockType==="agent"?detail.run.agentSnapshots[node.config.agentId]:undefined;
  if(!agent?.tools?.map(grantKey).includes(name)||!attempt||attempt.agentId!==agent.id||attempt.connectionKey!==agent.connectionKey||attempt.graphActivationId!==scope.activationId||attempt.iteration!==scope.iteration||attempt.attempt!==scope.attempt||attempt.status!=="starting"||!getProviderConnectionType(detail.run.connectionSnapshots[attempt.connectionKey]?.adapter??"")?.capabilities.agentTools)throw new Error("adt_data_authority_invalid");
  return detail.run.repositoryContext!;
}
