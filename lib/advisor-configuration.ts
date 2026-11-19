import {composeVersionedWorkflowV2,compileWorkflowV2ExecutionPlan,validateWorkflowReferences,validateWorkflowToolModels,workflowAgentReferences,type AgentDefinitionV1} from "./workflow-definitions.ts";
import {applyAdvisorOverride,assertAdvisorReadOnly,type AdvisorSettings} from "./advisor-policy.ts";
import type {WorkflowDefinitionRepository} from "./workflow-definition-repository.ts";
import type {ConnectionDescriptor} from "./workflow-connections.ts";

/** Reused by settings validation and presentation; launch independently resolves the same definitions. */
export async function validateAdvisorSelection(settings:AdvisorSettings,repository:Pick<WorkflowDefinitionRepository,"listWorkflows"|"getAgent">,connections:readonly ConnectionDescriptor[],validateDependencies?:(agents:readonly AgentDefinitionV1[])=>Promise<void>){
  if(!settings.workflowId){if(settings.override)throw new Error("advisor_workflow_required");return undefined}
  const workflows=await repository.listWorkflows(),selected=workflows.find(item=>item.definition.id===settings.workflowId);
  if(!selected)throw new Error("advisor_workflow_invalid");
  const composed=composeVersionedWorkflowV2(selected,workflows),versions=await Promise.all(workflowAgentReferences(composed.workflow).map(id=>repository.getAgent(id)));
  if(versions.some(item=>!item))throw new Error("missing_agent");
  const effective=applyAdvisorOverride(versions.map(item=>item!.definition),connections,settings.override),plan=compileWorkflowV2ExecutionPlan(composed.workflow,effective.agents);
  assertAdvisorReadOnly(plan,effective.agents,effective.connections);
  await validateWorkflowReferences(composed.workflow,effective.agents,new Set(effective.connections.filter(c=>c.enabled).map(c=>c.key)));
  validateWorkflowToolModels(plan,effective.agents,effective.connections);
  await validateDependencies?.(effective.agents);
  return {workflow:{id:selected.definition.id,name:selected.definition.name,revision:selected.fileSha},agents:effective.agents.map(agent=>({id:agent.id,name:agent.name,connectionKey:agent.connectionKey,provider:effective.connections.find(c=>c.key===agent.connectionKey)!.adapter,model:effective.connections.find(c=>c.key===agent.connectionKey)!.defaultModel}))};
}
