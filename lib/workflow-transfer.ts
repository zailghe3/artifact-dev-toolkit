import {z} from "zod";
import {workflowDefinitionV2Schema,MAX_WORKFLOW_STEPS,MAX_STEP_EXECUTIONS,WORKFLOW_RUN_INPUT_MAX_LENGTH} from "./workflow-definitions.ts";
import {workflowLayoutSchema,MAX_EDGE_WAYPOINTS} from "./workflow-layout.ts";
import {publishGitHubPrBlockConfigSchema,MAX_AGENT_CONTEXT_SOURCES} from "./workflow-block-registry.ts";
import {DEFINITION_ID_MAX_LENGTH} from "./definition-id.ts";

// Worst-case JSON escaping is six bytes per UTF-16 code unit. Allow every node
// the largest supported config text budget, all context IDs, plus generous
// structural/pretty-print space. Layout numbers need at most 24 JSON characters.
const nodeTextBudget=publishGitHubPrBlockConfigSchema.shape.body.maxLength!+publishGitHubPrBlockConfigSchema.shape.title.maxLength!+4096+2000+(MAX_AGENT_CONTEXT_SOURCES+4)*DEFINITION_ID_MAX_LENGTH;
export const WORKFLOW_TRANSFER_MAX_BYTES=6*(WORKFLOW_RUN_INPUT_MAX_LENGTH+2000+120+DEFINITION_ID_MAX_LENGTH+MAX_WORKFLOW_STEPS*nodeTextBudget)+4096*(1+MAX_WORKFLOW_STEPS+MAX_STEP_EXECUTIONS)+MAX_STEP_EXECUTIONS*MAX_EDGE_WAYPOINTS*128;
export const WORKFLOW_TRANSFER_MAX_COORDINATE=1_000_000;

export const workflowTransferSchema=z.object({
 format:z.literal("adt-workflow-transfer"),version:z.literal(1),
 definition:workflowDefinitionV2Schema,layout:workflowLayoutSchema.optional(),
}).strict().superRefine(({definition,layout},ctx)=>{
 if(!layout)return;
 const points=[...Object.values(layout.positions),...Object.values(layout.edgeWaypoints??{}).flat(),layout.viewport];
 if(points.some(point=>Math.abs(point.x)>WORKFLOW_TRANSFER_MAX_COORDINATE||Math.abs(point.y)>WORKFLOW_TRANSFER_MAX_COORDINATE))ctx.addIssue({code:"custom",path:["layout"],message:"Layout coordinates must be within one million units of the origin."});
 if(layout.workflowId!==definition.id)ctx.addIssue({code:"custom",path:["layout","workflowId"],message:"Layout Workflow ID must match the definition ID."});
 const nodes=new Set(definition.nodes.map(node=>node.id)),edges=new Set(definition.edges.map(edge=>edge.id));
 if(Object.keys(layout.positions).some(id=>!nodes.has(id)))ctx.addIssue({code:"custom",path:["layout","positions"],message:"Layout positions reference unknown nodes."});
 if(Object.keys(layout.edgeWaypoints??{}).some(id=>!edges.has(id)))ctx.addIssue({code:"custom",path:["layout","edgeWaypoints"],message:"Layout waypoints reference unknown edges."});
});
export type WorkflowTransfer=z.infer<typeof workflowTransferSchema>;

export type WorkflowTransferResult={ok:true;transfer:WorkflowTransfer}|{ok:false;error:string};
/** User-authored clipboard boundary. Never return Zod messages containing pasted data. */
export function parseWorkflowTransfer(text:string):WorkflowTransferResult{
 if(text.length>WORKFLOW_TRANSFER_MAX_BYTES||new TextEncoder().encode(text).length>WORKFLOW_TRANSFER_MAX_BYTES)return{ok:false,error:"Workflow transfer is too large. Reduce text or graph size and try again."};
 let value:unknown;try{value=JSON.parse(text)}catch{return{ok:false,error:"Invalid JSON. Paste only the Workflow Transfer JSON object, without Markdown fences."}}
 if(!value||typeof value!=="object"||Array.isArray(value))return{ok:false,error:"Paste a Workflow Transfer JSON object."};
 const envelope=value as Record<string,unknown>;
 if(envelope.format!=="adt-workflow-transfer")return{ok:false,error:'Wrong format. Expected "adt-workflow-transfer".'};
 if(envelope.version!==1)return{ok:false,error:"Unsupported Workflow Transfer version. This editor supports version 1."};
 let result:ReturnType<typeof workflowTransferSchema.safeParse>;
 try{result=workflowTransferSchema.safeParse(value)}catch{return{ok:false,error:"Invalid Workflow v2 definition. Check block configuration and graph references against the authoring context."}}
 if(result.success)return{ok:true,transfer:result.data};
 const issue=result.error.issues[0],root=issue.path[0];
 if(root==="definition")return{ok:false,error:"Invalid Workflow v2 definition. Check required fields, block configs, ports, graph topology, and limits against the authoring context."};
 if(root==="layout")return{ok:false,error:issue.code==="custom"?issue.message:"Invalid layout. Use layout version 1, finite coordinates, supported zoom and waypoint counts."};
 return{ok:false,error:"Invalid transfer envelope. Only format, version, definition, and optional layout are permitted."};
}
