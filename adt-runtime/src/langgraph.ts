import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { BaseCheckpointSaver, type Checkpoint, type CheckpointListOptions, type CheckpointMetadata, type CheckpointTuple, type ChannelVersions, type PendingWrite } from "@langchain/langgraph-checkpoint";
import type {RunnableConfig} from "@langchain/core/runnables";
import {z} from "zod";

export const LANGGRAPH_LINEAR_CAPABILITY="langgraph:linear";
export const MAX_CHECKPOINT_RESPONSE_BYTES=1_100_000;
export const LANGGRAPH_EXECUTE_PATH="/v1/executions/langgraph-linear";
const bounded=z.string().min(1).max(256),node=z.object({id:bounded.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),agentId:bounded.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)}).strict(),edge=z.object({source:bounded,target:bounded}).strict();
export const langGraphExecutionSchema=z.object({protocolVersion:z.literal("adt-runtime-v1"),capability:z.literal(LANGGRAPH_LINEAR_CAPABILITY),requestId:bounded,runId:z.string().uuid(),initialInput:z.string().max(262_144),plan:z.object({nodes:z.array(node).min(1).max(32),edges:z.array(edge).max(31),entryNodeId:bounded,terminalNodeId:bounded,maxStepExecutions:z.number().int().min(1).max(128)}).strict(),checkpointGateway:z.object({url:z.string().url().max(2048),authority:z.string().min(32).max(4096)}).strict(),nodeGateway:z.object({url:z.string().url().max(2048),authority:z.string().min(32).max(4096)}).strict()}).strict();
export type LangGraphExecutionRequest=z.infer<typeof langGraphExecutionSchema>;

export type LinearPlan={nodes:Array<{id:string;agentId:string}>;edges:Array<{source:string;target:string}>;entryNodeId:string;terminalNodeId:string;maxStepExecutions:number};
export type LinearState={input:string;output:string;executions:number};
export type ExecuteNode=(node:{id:string;agentId:string},input:string)=>Promise<string>;

export function orderedLinearNodes(plan:LinearPlan){
 const byId=new Map(plan.nodes.map(node=>[node.id,node])),next=new Map<string,string>();
 if(byId.size!==plan.nodes.length||!byId.has(plan.entryNodeId)||!byId.has(plan.terminalNodeId))throw new Error("langgraph_plan_invalid");
 for(const edge of plan.edges){if(!byId.has(edge.source)||!byId.has(edge.target)||next.has(edge.source))throw new Error("langgraph_plan_invalid");next.set(edge.source,edge.target)}
 const order:typeof plan.nodes=[];let id:string|undefined=plan.entryNodeId;
 while(id){if(order.some(node=>node.id===id))throw new Error("langgraph_plan_invalid");const node=byId.get(id);if(!node)throw new Error("langgraph_plan_invalid");order.push(node);if(id===plan.terminalNodeId){id=undefined;break}id=next.get(id)}
 if(order.length!==plan.nodes.length||order.at(-1)?.id!==plan.terminalNodeId||plan.edges.length!==plan.nodes.length-1||plan.maxStepExecutions<order.length)throw new Error("langgraph_plan_invalid");
 return order;
}

const State=Annotation.Root({input:Annotation<string>,output:Annotation<string>,executions:Annotation<number>});
export function compileLinearStateGraph(plan:LinearPlan,execute:ExecuteNode,checkpointer?:BaseCheckpointSaver,interruptAfter?:"*"){
 const order=orderedLinearNodes(plan);let graph=new StateGraph(State);
 for(const [index,node] of order.entries())graph=graph.addNode(node.id,async(state:LinearState)=>{if(state.executions>=plan.maxStepExecutions)throw new Error("execution_limit_exceeded");const input=index===0?state.input:state.output;return{output:await execute(node,input),executions:state.executions+1}}) as typeof graph;
 graph=graph.addEdge(START,plan.entryNodeId as "__start__") as typeof graph;
 for(const edge of plan.edges)graph=graph.addEdge(edge.source as "__start__",edge.target as "__start__") as typeof graph;
 graph=graph.addEdge(plan.terminalNodeId as "__start__",END) as typeof graph;
 return graph.compile({checkpointer,interruptAfter});
}

class NodePending extends Error{readonly state:"pending"|"failed"|"cancelled";readonly safeMessage?:string;constructor(state:"pending"|"failed"|"cancelled",safeMessage?:string){super("langgraph_node_pending");this.state=state;this.safeMessage=safeMessage}}
function safeGatewayUrl(raw:string){const url=new URL(raw);if(url.protocol!=="https:"&&!(["localhost","127.0.0.1","::1"].includes(url.hostname)))throw new Error("langgraph_gateway_invalid");return url.toString()}
export async function advanceLinearGraph(request:LangGraphExecutionRequest,fetcher:typeof fetch=fetch){const parsed=langGraphExecutionSchema.parse(request),config={configurable:{thread_id:parsed.runId}},saver=new RemoteCheckpointSaver(safeGatewayUrl(parsed.checkpointGateway.url),parsed.checkpointGateway.authority,parsed.runId,fetcher),execute:ExecuteNode=async(node,input)=>{let response:Response;try{response=await fetcher(safeGatewayUrl(parsed.nodeGateway.url),{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${parsed.nodeGateway.authority}`},body:JSON.stringify({runId:parsed.runId,nodeId:node.id,inputText:input}),signal:AbortSignal.timeout(30_000)})}catch{throw new NodePending("pending")}let value:unknown;try{value=await response.json()}catch{throw new NodePending("pending")}const wire=value&&typeof value==="object"?value as Record<string,unknown>:{};if(response.ok&&wire.state==="completed"&&typeof wire.outputText==="string"&&Buffer.byteLength(wire.outputText)<=262_144)return wire.outputText;if(wire.state==="failed"||wire.state==="cancelled")throw new NodePending(wire.state,typeof wire.safeMessage==="string"?wire.safeMessage.slice(0,512):undefined);throw new NodePending("pending")},graph=compileLinearStateGraph(parsed.plan,execute,saver,"*");try{const existing=await saver.getTuple(config),result=await graph.invoke(existing?null:{input:parsed.initialInput,output:"",executions:0},config),snapshot=await graph.getState(config),next=Array.isArray(snapshot.next)?snapshot.next:[];return next.length?{state:"advanced" as const,outputText:result.output,nextNodeId:String(next[0])}:{state:"completed" as const,outputText:result.output}}catch(error){if(error instanceof NodePending)return{state:error.state,safeMessage:error.safeMessage};throw error}}

type GatewayRequest={operation:"get"|"list"|"put"|"putWrites"|"deleteThread";threadId:string;payload?:unknown};
export class RemoteCheckpointSaver extends BaseCheckpointSaver {
 private readonly gatewayUrl:string;private readonly authority:string;private readonly threadId:string;private readonly fetcher:typeof fetch;
 constructor(gatewayUrl:string,authority:string,threadId:string,fetcher:typeof fetch=fetch){super();this.gatewayUrl=gatewayUrl;this.authority=authority;this.threadId=threadId;this.fetcher=fetcher;if(!threadId||!gatewayUrl||!authority)throw new Error("checkpoint_configuration_invalid")}
 private async request<T>(operation:GatewayRequest["operation"],payload?:unknown):Promise<T>{const body=JSON.stringify({operation,threadId:this.threadId,...(payload===undefined?{}:{payload})});let response:Response;try{response=await this.fetcher(this.gatewayUrl,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${this.authority}`},body,signal:AbortSignal.timeout(10_000)})}catch{throw new Error("checkpoint_persistence_unavailable")}const text=await response.text();if(Buffer.byteLength(text)>MAX_CHECKPOINT_RESPONSE_BYTES)throw new Error("checkpoint_state_invalid");let value;try{value=JSON.parse(text)}catch{throw new Error("checkpoint_state_invalid")}if(!response.ok||!value||value.ok!==true)throw new Error(response.status===401||response.status===403?"checkpoint_authority_invalid":response.status===409?"checkpoint_state_conflicting":"checkpoint_persistence_unavailable");return value.result as T}
 private exact(config:RunnableConfig){if(config.configurable?.thread_id!==this.threadId)throw new Error("checkpoint_authority_invalid")}
 async getTuple(config:RunnableConfig){this.exact(config);return (await this.request<CheckpointTuple|null>("get",{config}))??undefined}
 async *list(config:RunnableConfig,options?:CheckpointListOptions){this.exact(config);for(const item of await this.request<CheckpointTuple[]>("list",{config,options}))yield item}
 async put(config:RunnableConfig,checkpoint:Checkpoint,metadata:CheckpointMetadata,newVersions:ChannelVersions){this.exact(config);return this.request<RunnableConfig>("put",{config,checkpoint,metadata,newVersions})}
 async putWrites(config:RunnableConfig,writes:PendingWrite[],taskId:string){this.exact(config);await this.request("putWrites",{config,writes,taskId})}
 async deleteThread(threadId:string){if(threadId!==this.threadId)throw new Error("checkpoint_authority_invalid");await this.request("deleteThread")}
}
