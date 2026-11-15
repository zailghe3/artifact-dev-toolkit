import {z} from "zod";
import {isAdtDataTool} from "./adt-data-contract.ts";
import {validateAgentForConnection,type AgentDefinitionV1,type GenericWorkflowExecutionPlan} from "./workflow-definitions.ts";
import {getProviderConnectionType} from "./provider-connection-types.ts";
import type {ConnectionDescriptor} from "./workflow-connections.ts";
import type {WorkflowRun} from "./workflow-storage.ts";

const id=z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
export const advisorSettingsSchema=z.object({workflowId:id.nullable(),override:z.object({connectionKey:id,model:z.string().trim().min(1).max(120).regex(/^[^\s\x00-\x1f\x7f]+$/)}).strict().nullable()}).strict();
export type AdvisorSettings=z.infer<typeof advisorSettingsSchema>;
export const advisorRunContextSchema=z.object({version:z.literal(1),readOnly:z.literal(true),override:advisorSettingsSchema.shape.override}).strict();
export type AdvisorRunContext=z.infer<typeof advisorRunContextSchema>;
export const sameRepositoryContext=(a:WorkflowRun["repositoryContext"],b:WorkflowRun["repositoryContext"])=>Boolean(a&&b&&a.repositoryId===b.repositoryId&&a.installationId===b.installationId&&a.owner.toLowerCase()===b.owner.toLowerCase()&&a.repository.toLowerCase()===b.repository.toLowerCase()&&a.branch===b.branch&&a.root===b.root);

/** Closed capability allowlist: external tools and provider-hosted actions cannot be proven read-only. */
export function assertAdvisorReadOnly(plan:GenericWorkflowExecutionPlan,agents:readonly AgentDefinitionV1[],connections:readonly ConnectionDescriptor[],mcpTools?:WorkflowRun["mcpToolSnapshots"],managed?:WorkflowRun["managedCodeRepositoryContexts"]){
  if(plan.nodes.some(node=>!["agent","condition","join","approval"].includes(node.blockType))||Object.values(mcpTools??{}).some(tools=>tools.length)||Object.keys(managed??{}).length)throw new Error("advisor_read_only_required");
  const byId=new Map(agents.map(agent=>[agent.id,agent]));
  for(const node of plan.nodes){
    if(node.blockType!=="agent")continue;
    const agent=byId.get(node.config.agentId),connection=connections.find(item=>item.key===agent?.connectionKey);
    if(!agent||!connection||!getProviderConnectionType(connection.adapter)?.capabilities.agentTools||!connection.enabled||!connection.defaultModel||(node.blockVersion===3||node.blockVersion===4)&&node.config.conversation)throw new Error("advisor_provider_incompatible");
    if(agent.tools?.some(grant=>!isAdtDataTool(typeof grant==="string"?grant:grant.type==="builtin"?grant.name:"")))throw new Error("advisor_read_only_required");
    // Snapshot hydration retains only execution capabilities; the provider policy is fixed here.
    validateAgentForConnection(agent,{...connection,capabilities:getProviderConnectionType(connection.adapter)!.capabilities});
  }
}

/** Re-applied at consumption using only persisted authority, never current editable definitions. */
export function assertAdvisorRunReadOnly(run:WorkflowRun){
  if(!run.advisorContext)return;
  advisorRunContextSchema.parse(run.advisorContext);
  if(!run.executionPlan||!("planVersion" in run.executionPlan)||!run.repositoryContext)throw new Error("advisor_read_only_required");
  assertAdvisorReadOnly(run.executionPlan,Object.values(run.agentSnapshots),Object.values(run.connectionSnapshots),run.mcpToolSnapshots,run.managedCodeRepositoryContexts);
}

export function applyAdvisorOverride(agents:readonly AgentDefinitionV1[],connections:readonly ConnectionDescriptor[],override:AdvisorSettings["override"]){
  const selected=override?connections.find(connection=>connection.key===override.connectionKey):undefined;
  if(override&&(!selected||!selected.enabled||selected.management!=="git"||!getProviderConnectionType(selected.adapter)?.capabilities.agentTools))throw new Error("advisor_provider_incompatible");
  const effectiveConnections=connections.map(connection=>override&&connection.key===override.connectionKey?{...connection,defaultModel:override.model}:structuredClone(connection));
  const effectiveAgents=agents.map(agent=>{
    const effective=override?{...structuredClone(agent),connectionKey:override.connectionKey}:structuredClone(agent);
    const connection=effectiveConnections.find(connection=>connection.key===effective.connectionKey);
    if(!connection)throw new Error("connection_unavailable");
    try{return validateAgentForConnection(effective,connection)}catch{throw new Error("advisor_provider_incompatible")}
  });
  return {agents:effectiveAgents,connections:effectiveConnections};
}
