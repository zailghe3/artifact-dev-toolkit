import {z} from "zod";
import {ADVISOR_WORKFLOW_ID,executionPolicySchema} from "../adt-runtime/src/conversation-contract.ts";
import {isAdtDataTool} from "./adt-data-contract.ts";
import {validateAgentConnectionOptions,type AgentDefinitionV1,type GenericWorkflowExecutionPlan} from "./workflow-definitions.ts";
import {getProviderConnectionType} from "./provider-connection-types.ts";
import type {ConnectionDescriptor} from "./workflow-connections.ts";
import type {WorkflowRun} from "./workflow-storage.ts";

import { advisorSettingsSchema } from "../adt-runtime/src/operational-settings-contract.ts";
export const advisorRunContextSchema=z.object({version:z.literal(1),readOnly:z.literal(true),override:advisorSettingsSchema.shape.override}).strict();
export type AdvisorRunContext=z.infer<typeof advisorRunContextSchema>;
export const sameRepositoryContext=(a:WorkflowRun["repositoryContext"],b:WorkflowRun["repositoryContext"])=>Boolean(a&&b&&a.repositoryId===b.repositoryId&&a.installationId===b.installationId&&a.owner.toLowerCase()===b.owner.toLowerCase()&&a.repository.toLowerCase()===b.repository.toLowerCase()&&a.branch===b.branch&&a.root===b.root);

type PolicySources = Pick<WorkflowRun,"workflowId"|"semanticWorkflowSnapshot"|"compositionSnapshot"|"agentSnapshots">;
const declaresReadOnly = (run: PolicySources) => run.semanticWorkflowSnapshot?.executionPolicy === "read-only" ||
  run.compositionSnapshot?.dependencies.some(item => item.definition.executionPolicy === "read-only") ||
  Object.values(run.agentSnapshots ?? {}).some(agent => agent.executionPolicy === "read-only");

export function requiredExecutionPolicy(run: PolicySources) {
  if (run.workflowId === ADVISOR_WORKFLOW_ID || declaresReadOnly(run)) return "read-only" as const;
}

export const hasReadOnlyExecution = (run: Pick<WorkflowRun,"executionPolicy"|"advisorContext">) =>
  run.executionPolicy === "read-only" || Boolean(run.advisorContext);

/** Closed capability allowlist: external tools and provider-hosted actions cannot be proven read-only. */
export function assertReadOnlyExecution(plan:GenericWorkflowExecutionPlan,agents:readonly AgentDefinitionV1[],connections:readonly ConnectionDescriptor[],mcpTools?:WorkflowRun["mcpToolSnapshots"],managed?:WorkflowRun["managedCodeRepositoryContexts"],legacy=false){
  const restricted = legacy ? "advisor_read_only_required" : "execution_read_only_required";
  if(plan.nodes.some(node=>!["agent","condition","join","approval","knowledge-proposal"].includes(node.blockType))||Object.values(mcpTools??{}).some(tools=>tools.length)||Object.keys(managed??{}).length)throw new Error(restricted);
  const byId=new Map(agents.map(agent=>[agent.id,agent]));
  for(const node of plan.nodes){
    if(node.blockType!=="agent")continue;
    const agent=byId.get(node.config.agentId),connection=connections.find(item=>item.key===agent?.connectionKey);
    if(!agent||!connection||!getProviderConnectionType(connection.adapter)?.capabilities.agentTools||!connection.enabled||!connection.defaultModel||(node.blockVersion===3||node.blockVersion===4)&&node.config.conversation)throw new Error(legacy ? "advisor_provider_incompatible" : "execution_read_only_provider");
    if(agent.tools?.some(grant=>!isAdtDataTool(typeof grant==="string"?grant:grant.type==="builtin"?grant.name:"")))throw new Error(restricted);
    // Historical consumption rechecks authority using the frozen configuration.
    validateAgentConnectionOptions(agent,{...connection,capabilities:getProviderConnectionType(connection.adapter)!.capabilities});
  }
}

/** Re-applied at consumption using only persisted authority, never current editable definitions. */
export function assertRunExecutionPolicy(run:WorkflowRun){
  if (run.executionPolicy !== undefined) executionPolicySchema.parse(run.executionPolicy);
  if (run.advisorContext) advisorRunContextSchema.parse(run.advisorContext);
  if (!hasReadOnlyExecution(run)) {
    if (declaresReadOnly(run)) throw new Error("execution_read_only_required");
    return;
  }
  if(!run.executionPlan||!("planVersion" in run.executionPlan)||!run.repositoryContext)throw new Error(run.advisorContext ? "advisor_read_only_required" : "execution_read_only_required");
  assertReadOnlyExecution(run.executionPlan,Object.values(run.agentSnapshots),Object.values(run.connectionSnapshots),run.mcpToolSnapshots,run.managedCodeRepositoryContexts,Boolean(run.advisorContext));
}

export function assertPublicationPolicy(run: WorkflowRun) {
  if (hasReadOnlyExecution(run)) throw new Error("execution_read_only_required");
}
