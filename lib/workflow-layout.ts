import {z} from "zod";
import {DEFINITION_ID,type WorkflowDefinition} from "./workflow-definitions.ts";

const finite=z.number().finite();
const definitionId=z.string().regex(DEFINITION_ID).max(80);
const position=z.object({x:finite,y:finite}).strict();
export const MAX_EDGE_WAYPOINTS=8;
const edgeRoutes=z.record(definitionId,z.array(position).max(MAX_EDGE_WAYPOINTS)).refine(value=>Object.keys(value).length<=128,"Too many edge routes.");

export const workflowLayoutSchema=z.object({
 schemaVersion:z.literal(1),
 workflowId:definitionId,
 positions:z.record(definitionId,position),
 edgeWaypoints:edgeRoutes.optional(),
 viewport:z.object({x:finite,y:finite,zoom:z.number().finite().min(0.1).max(4)}).strict(),
}).strict();

export type WorkflowLayoutV1=z.infer<typeof workflowLayoutSchema>;
export type WorkflowVisualNode={id:string;position:{x:number;y:number};data:{label:string;agentId:string;stepNumber?:number;kind:"step"|"block"}};
export type WorkflowVisualEdge={id:string;source:string;target:string};

export const workflowLayoutPath=(workflowId:string)=>`workflows/${definitionId.parse(workflowId)}.layout.json`;

export function defaultStepPosition(index:number){return{x:index*260,y:40};}

/** Reconciles saved presentation state with the current semantic graph. */
export function projectSequentialWorkflow(workflow:WorkflowDefinition,layout?:WorkflowLayoutV1){const saved=layout?.workflowId===workflow.id?layout.positions:{};const semantic=workflow.nodes.map(node=>({id:node.id,name:node.blockType,agentId:String((node.config as {agentId?:string}).agentId??""),kind:"block" as const}));const nodes:WorkflowVisualNode[]=semantic.map((node,index)=>({id:node.id,position:saved[node.id]??defaultStepPosition(index),data:{label:node.name,agentId:node.agentId,kind:node.kind}}));return{nodes,edges:workflow.edges,viewport:layout?.workflowId===workflow.id?layout.viewport:{x:0,y:0,zoom:1},edgeWaypoints:layout?.workflowId===workflow.id?layout.edgeWaypoints??{}:{}};}
export function normalizeWorkflowLayout(workflow:WorkflowDefinition,positions:Record<string,{x:number;y:number}>,viewport:{x:number;y:number;zoom:number},edgeWaypoints:Record<string,{x:number;y:number}[]>={}):WorkflowLayoutV1{return workflowLayoutSchema.parse({schemaVersion:1,workflowId:workflow.id,positions:Object.fromEntries(workflow.nodes.map((node,index)=>[node.id,positions[node.id]??defaultStepPosition(index)])),edgeWaypoints:Object.fromEntries(workflow.edges.flatMap(edge=>edgeWaypoints[edge.id]?.length?[[edge.id,edgeWaypoints[edge.id]]]:[])),viewport});}

export function placeNodeInViewport(viewport:{x:number;y:number;zoom:number},size:{width:number;height:number},positions:readonly {x:number;y:number}[],fallback:{x:number;y:number}){if(!Number.isFinite(size.width)||!Number.isFinite(size.height)||size.width<=0||size.height<=0||viewport.zoom<=0)return fallback;const center={x:(size.width/2-viewport.x)/viewport.zoom-88,y:(size.height/2-viewport.y)/viewport.zoom-40};for(let index=0;index<12;index++){const candidate={x:center.x+(index%4)*28,y:center.y+Math.floor(index/4)*28};if(!positions.some(position=>Math.abs(position.x-candidate.x)<24&&Math.abs(position.y-candidate.y)<24))return candidate}return center;}

export function workflowExecutionLimitFromDraft(value:number|""){return value===""?1:value}
