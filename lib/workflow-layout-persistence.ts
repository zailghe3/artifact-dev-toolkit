import type {WorkflowDefinitionRepository} from "./workflow-definition-repository.ts";
import {DefinitionNotFoundError} from "./workflow-definition-repository.ts";
import type {WorkflowLayoutRepository} from "./workflow-layout-repository.ts";
import type {WorkflowLayoutV1} from "./workflow-layout.ts";

/** Persists layout only when it was validated against the exact authoritative semantic revision. */
export async function persistLayoutAgainstWorkflowRevision(definitions:WorkflowDefinitionRepository,layouts:WorkflowLayoutRepository,layout:WorkflowLayoutV1,workflowFileSha:string,layoutFileSha?:string){
 const workflow=await definitions.getWorkflow(layout.workflowId);
 if(!workflow)throw new DefinitionNotFoundError();
 if(workflow.fileSha!==workflowFileSha)throw new Error("workflow_revision_not_observed");
 const nodeIds=new Set(workflow.definition.nodes.map(node=>node.id));
 if(Object.keys(layout.positions).some(nodeId=>!nodeIds.has(nodeId)))throw new Error("invalid_json");
 return layoutFileSha?layouts.updateLayout(layout,layoutFileSha):layouts.createLayout(layout);
}
