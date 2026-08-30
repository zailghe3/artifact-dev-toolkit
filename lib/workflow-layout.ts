import {z} from "zod";
import {DEFINITION_ID,type WorkflowDefinition} from "./workflow-definitions.ts";

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
export type WorkflowVisualNode={id:string;position:{x:number;y:number};data:{label:string;agentId:string;stepNumber?:number;kind:"step"|"block"}};
export type WorkflowVisualEdge={id:string;source:string;target:string};

export const workflowLayoutPath=(workflowId:string)=>`workflows/${definitionId.parse(workflowId)}.layout.json`;

export function defaultStepPosition(index:number){return{x:index*260,y:40};}

/** Reconciles saved presentation state with the current semantic graph. */
export function projectSequentialWorkflow(workflow:WorkflowDefinition,layout?:WorkflowLayoutV1){const saved=layout?.workflowId===workflow.id?layout.positions:{};const semantic=workflow.nodes.map(node=>({id:node.id,name:node.blockType,agentId:String((node.config as {agentId?:string}).agentId??""),kind:"block" as const}));const nodes:WorkflowVisualNode[]=semantic.map((node,index)=>({id:node.id,position:saved[node.id]??defaultStepPosition(index),data:{label:node.name,agentId:node.agentId,kind:node.kind}}));return{nodes,edges:workflow.edges,viewport:layout?.workflowId===workflow.id?layout.viewport:{x:0,y:0,zoom:1}};}
export function normalizeWorkflowLayout(workflow:WorkflowDefinition,positions:Record<string,{x:number;y:number}>,viewport:{x:number;y:number;zoom:number}):WorkflowLayoutV1{return workflowLayoutSchema.parse({schemaVersion:1,workflowId:workflow.id,positions:Object.fromEntries(workflow.nodes.map((node,index)=>[node.id,positions[node.id]??defaultStepPosition(index)])),viewport});}
