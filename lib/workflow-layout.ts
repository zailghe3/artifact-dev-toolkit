import {z} from "zod";
import {DEFINITION_ID,type WorkflowDefinitionV1} from "./workflow-definitions.ts";

const finite=z.number().finite();
const definitionId=z.string().regex(DEFINITION_ID).max(80);
const position=z.object({x:finite,y:finite}).strict();

export const workflowLayoutSchema=z.object({
 schemaVersion:z.literal(1),
 workflowId:definitionId,
 positions:z.record(definitionId,position),
 viewport:z.object({x:finite,y:finite,zoom:z.number().finite().min(0.1).max(4)}).strict(),
}).strict();

export type WorkflowLayoutV1=z.infer<typeof workflowLayoutSchema>;
export type WorkflowVisualNode={id:string;position:{x:number;y:number};data:{label:string;agentId:string;stepNumber:number}};
export type WorkflowVisualEdge={id:string;source:string;target:string};

export const workflowLayoutPath=(workflowId:string)=>`workflows/${definitionId.parse(workflowId)}.layout.json`;

export function defaultStepPosition(index:number){return{x:index*260,y:40};}

/** Reconciles saved presentation state with the current semantic v1 Workflow. */
export function projectSequentialWorkflow(workflow:WorkflowDefinitionV1,layout?:WorkflowLayoutV1){
 const saved=layout?.workflowId===workflow.id?layout.positions:{};
 const nodes:WorkflowVisualNode[]=workflow.steps.map((step,index)=>({id:step.id,position:saved[step.id]??defaultStepPosition(index),data:{label:step.name,agentId:step.agentId,stepNumber:index+1}}));
 const edges:WorkflowVisualEdge[]=workflow.steps.slice(1).map((step,index)=>({id:`sequence-${workflow.steps[index].id}-${step.id}`,source:workflow.steps[index].id,target:step.id}));
 return{nodes,edges,viewport:layout?.workflowId===workflow.id?layout.viewport:{x:0,y:0,zoom:1}};
}

export function normalizeWorkflowLayout(workflow:WorkflowDefinitionV1,positions:Record<string,{x:number;y:number}>,viewport:{x:number;y:number;zoom:number}):WorkflowLayoutV1{
 return workflowLayoutSchema.parse({schemaVersion:1,workflowId:workflow.id,positions:Object.fromEntries(workflow.steps.map((step,index)=>[step.id,positions[step.id]??defaultStepPosition(index)])),viewport});
}
