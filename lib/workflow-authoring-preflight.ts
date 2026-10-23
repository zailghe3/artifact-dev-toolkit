import type {WorkflowDefinitionV2} from "./workflow-definitions.ts";
import {canContinueWorkflowConversation,type WorkflowEditorAgent} from "./workflow-publish-authoring.ts";
import type {ReusableWorkflow} from "./workflow-editor-state.ts";

/** Only checks references/capabilities already known to the authorised editor. */
export function workflowAuthoringPreflight(workflow:WorkflowDefinitionV2,agents:readonly WorkflowEditorAgent[],reusable:readonly ReusableWorkflow[],existingIds:readonly string[]=[]){
 const errors:string[]=[],byId=new Map(agents.map(agent=>[agent.id,agent]));
 if(existingIds.includes(workflow.id))errors.push(`Workflow ID already exists: ${workflow.id}. Choose another ID before creating.`);
 const agentForNode=(id:string)=>{const node=workflow.nodes.find(node=>node.id===id);return node?.blockType==="agent"?byId.get((node.config as {agentId:string}).agentId):undefined};
 for(const node of workflow.nodes){
  const config=node.config as {agentId?:string;workflowId?:string;sourceNodeId?:string;conversation?:{sourceNodeId:string}};
  if(node.blockType==="agent"){
   if(!byId.has(config.agentId!))errors.push(`Missing Agent: ${config.agentId}. Select a replacement for ${node.id}.`);
   if(config.conversation&&!canContinueWorkflowConversation(agentForNode(config.conversation.sourceNodeId),byId.get(config.agentId!)))errors.push(`Incompatible conversation source for ${node.id}. Clear continuation or select compatible Agents.`);
  }
  if(node.blockType==="subworkflow"&&!reusable.some(value=>value.id===config.workflowId))errors.push(`Missing reusable Workflow: ${config.workflowId}. Select a replacement for ${node.id}.`);
  if(node.blockType==="publish-github-pr"&&!agentForNode(config.sourceNodeId!)?.publishEligible)errors.push(`Publish GitHub PR source for ${node.id} is not eligible for managed publication. Select an eligible source Agent.`);
 }
 return errors;
}
