import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { BaseCheckpointSaver, type Checkpoint, type CheckpointListOptions, type CheckpointMetadata, type CheckpointTuple, type ChannelVersions, type PendingWrite } from "@langchain/langgraph-checkpoint";
import type {RunnableConfig} from "@langchain/core/runnables";
import {z} from "zod";
import {knowledgeProposalBlockConfigSchema} from "./conversation-contract.js";
import { approvalOutcomes, dynamicDecisionOptionsSchema, graphInteractionSchema, interactionPlanNodes,
  interactionRequestSchema, interactionResponseSchema, MAX_DECISION_OPTION_BYTES, validateInteractionResponse,
  WORKFLOW_INTERACTION_VERSION, type InteractionRequest } from "./workflow-interaction-contract.js";

export const MAX_CHECKPOINT_RESPONSE_BYTES=1_100_000;
export const LANGGRAPH_EXECUTE_PATH="/v1/executions/langgraph-linear";
import {GRAPH_NODE_PROVIDER_TIMEOUT_MS} from "./provider-timeouts.js";
export const GRAPH_NODE_GATEWAY_TIMEOUT_MS=GRAPH_NODE_PROVIDER_TIMEOUT_MS;
const bounded=z.string().min(1).max(256);

class NodePending extends Error{readonly state:"pending"|"failed"|"cancelled";readonly safeMessage?:string;readonly retryAfterMs?:number;constructor(state:"pending"|"failed"|"cancelled",safeMessage?:string,retryAfterMs?:number){super("langgraph_node_pending");this.state=state;this.safeMessage=safeMessage;this.retryAfterMs=retryAfterMs}}
export type RuntimeOrchestrationEvidence={stage:"checkpoint_gateway"|"graph_node_gateway";code:string;httpStatus?:number;transportOutcome?:"response_received"|"timeout"|"network_error"};
export class GraphNodeGatewayFailure extends Error{readonly retryable:boolean;readonly orchestration:RuntimeOrchestrationEvidence;constructor(kind:"unavailable"|"invalid"|"backend",httpStatus?:number,transportOutcome?:RuntimeOrchestrationEvidence["transportOutcome"]){super(kind==="invalid"?"graph_node_gateway_invalid":"graph_node_gateway_unavailable");this.retryable=kind!=="invalid";this.orchestration={stage:"graph_node_gateway",code:kind==="invalid"?"graph_node_authority_invalid":kind==="backend"?"graph_node_backend_unavailable":"graph_node_unavailable",...(httpStatus?{httpStatus}:{}),...(transportOutcome?{transportOutcome}:{})}}}
export class CheckpointGatewayFailure extends Error{readonly orchestration:RuntimeOrchestrationEvidence;constructor(code:RuntimeOrchestrationEvidence["code"],httpStatus?:number,transportOutcome?:RuntimeOrchestrationEvidence["transportOutcome"]){super("checkpoint_gateway_failure");this.orchestration={stage:"checkpoint_gateway",code,...(httpStatus?{httpStatus}:{}),...(transportOutcome?{transportOutcome}:{})}}}
function callbackTransportOutcome(error:unknown){return error instanceof DOMException&&["AbortError","TimeoutError"].includes(error.name)?"timeout" as const:"network_error" as const}
function safeGatewayUrl(raw:string){const url=new URL(raw);if(url.protocol!=="https:"&&!(["localhost","127.0.0.1","::1"].includes(url.hostname)))throw new Error("langgraph_gateway_invalid");return url.toString()}
async function graphNodeResponse(response:Response){const malformed=()=>new GraphNodeGatewayFailure([401,403,409].includes(response.status)?"invalid":"unavailable",response.status,"response_received");if(response.status>=500)throw new GraphNodeGatewayFailure("backend",response.status,"response_received");let raw:string;try{raw=await response.text()}catch{throw new GraphNodeGatewayFailure("unavailable",response.status,"response_received")}if(Buffer.byteLength(raw)>300_000)throw malformed();let value:unknown;try{value=JSON.parse(raw)}catch{throw malformed()}const wire=value&&typeof value==="object"?value as Record<string,unknown>:{};if(response.ok&&wire.state==="completed"&&typeof wire.outputText==="string"&&Buffer.byteLength(wire.outputText)<=262_144)return wire.outputText;if(response.ok&&wire.state==="pending")throw new NodePending("pending",undefined,typeof wire.retryAfterMs==="number"&&Number.isFinite(wire.retryAfterMs)?Math.max(1000,Math.min(900000,Math.round(wire.retryAfterMs))):undefined);if(response.ok&&wire.state==="cancelled")throw new NodePending("cancelled",typeof wire.safeMessage==="string"?wire.safeMessage.slice(0,512):undefined);if(response.status===422&&wire.state==="failed"&&typeof wire.safeMessage==="string")throw new NodePending("failed",wire.safeMessage.slice(0,512));throw malformed()}
type GatewayRequest={operation:"get"|"list"|"put"|"putWrites"|"deleteThread";threadId:string;payload?:unknown};
export class RemoteCheckpointSaver extends BaseCheckpointSaver {
 private readonly gatewayUrl:string;private readonly authority:string;private readonly threadId:string;private readonly fetcher:typeof fetch;
 constructor(gatewayUrl:string,authority:string,threadId:string,fetcher:typeof fetch=fetch){super();this.gatewayUrl=gatewayUrl;this.authority=authority;this.threadId=threadId;this.fetcher=fetcher;if(!threadId||!gatewayUrl||!authority)throw new Error("checkpoint_configuration_invalid")}
 private async request<T>(operation:GatewayRequest["operation"],payload?:unknown):Promise<T>{const body=JSON.stringify({operation,threadId:this.threadId,...(payload===undefined?{}:{payload})});let response:Response;try{response=await this.fetcher(this.gatewayUrl,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${this.authority}`},body,signal:AbortSignal.timeout(10_000)})}catch(error){throw new CheckpointGatewayFailure("checkpoint_unavailable",undefined,callbackTransportOutcome(error))}let text:string;try{text=await response.text()}catch{throw new CheckpointGatewayFailure("checkpoint_unavailable",response.status,"response_received")}if(Buffer.byteLength(text)>MAX_CHECKPOINT_RESPONSE_BYTES)throw new CheckpointGatewayFailure("checkpoint_state_invalid",response.status,"response_received");let value;try{value=JSON.parse(text)}catch{throw new CheckpointGatewayFailure("checkpoint_state_invalid",response.status,"response_received")}if(!response.ok||!value||value.ok!==true)throw new CheckpointGatewayFailure(response.status===401||response.status===403?"checkpoint_authority_invalid":response.status===409?"checkpoint_state_conflicting":response.status>=500?"checkpoint_backend_unavailable":"checkpoint_unavailable",response.status,"response_received");return value.result as T}
 private exact(config:RunnableConfig){if(config.configurable?.thread_id!==this.threadId)throw new Error("checkpoint_authority_invalid")}
 async getTuple(config:RunnableConfig){this.exact(config);return (await this.request<CheckpointTuple|null>("get",{config}))??undefined}
 async *list(config:RunnableConfig,options?:CheckpointListOptions){this.exact(config);for(const item of await this.request<CheckpointTuple[]>("list",{config,options}))yield item}
 async put(config:RunnableConfig,checkpoint:Checkpoint,metadata:CheckpointMetadata,newVersions:ChannelVersions){this.exact(config);return this.request<RunnableConfig>("put",{config,checkpoint,metadata,newVersions})}
 async putWrites(config:RunnableConfig,writes:PendingWrite[],taskId:string,taskPath?:string){this.exact(config);await this.request("putWrites",{config,writes,taskId,...(taskPath===undefined?{}:{taskPath})})}
 async deleteThread(threadId:string){if(threadId!==this.threadId)throw new Error("checkpoint_authority_invalid");await this.request("deleteThread")}
}

export const LANGGRAPH_GRAPH_CAPABILITY="langgraph:graph";
export const LANGGRAPH_APPROVAL_CAPABILITY="langgraph:approval-interrupt";
export const LANGGRAPH_CONTEXT_SELECTION_CAPABILITY="langgraph:context-selection";
export const MAX_GRAPH_FRONTIER=3;
export const MAX_AGENT_INPUT_BYTES=262_144;
export const MAX_CONTEXT_GRAPH_STATE_BYTES=850_000;
const MAX_OUTPUT_RECORD_BYTES=MAX_AGENT_INPUT_BYTES+512;
const genericNode=z.union([
 ...interactionPlanNodes(bounded),
 z.object({id:bounded,blockType:z.literal("agent"),blockVersion:z.literal(1),config:z.object({agentId:bounded}).strict()}).strict(),
 z.object({id:bounded,blockType:z.literal("agent"),blockVersion:z.literal(2),config:z.object({agentId:bounded,context:z.object({publishOutput:z.boolean(),includeRunInput:z.boolean(),includeNodeOutputs:z.array(bounded).max(16)}).strict().optional()}).strict()}).strict(),
 z.object({id:bounded,blockType:z.literal("condition"),blockVersion:z.literal(1),config:z.object({operator:z.literal("contains"),value:z.string().min(1).max(4096),caseSensitive:z.boolean()}).strict()}).strict(),
 z.object({id:bounded,blockType:z.literal("knowledge-proposal"),blockVersion:z.literal(1),config:knowledgeProposalBlockConfigSchema}).strict(),
 z.object({id:bounded,blockType:z.literal("join"),blockVersion:z.literal(1),config:z.object({}).strict()}).strict(),
 z.object({id:bounded,blockType:z.literal("approval"),blockVersion:z.literal(1),config:z.object({message:z.string().trim().min(1).max(2000)}).strict()}).strict(), z.object({id:bounded,blockType:z.literal("publish-github-pr"),blockVersion:z.literal(1),config:z.object({sourceNodeId:bounded,title:z.string().trim().min(1).max(256),body:z.string().max(65536),draft:z.boolean()}).strict()}).strict(),
]);
const genericEdge=z.object({source:bounded,sourcePort:bounded,target:bounded,targetPort:bounded}).strict();
const exactAuthority=z.object({authority:z.string().min(32).max(4096),nodeId:bounded,activationId:bounded,workflowGeneration:z.number().int().positive(),iteration:z.number().int().positive(),attempt:z.number().int().positive()}).strict();
export const graphExecutionSchema=z.object({protocolVersion:z.literal("adt-runtime-v1"),capability:z.literal(LANGGRAPH_GRAPH_CAPABILITY),requestId:bounded,runId:z.string().uuid(),initialInput:z.string().max(262_144),plan:z.object({planVersion:z.literal(2),agentExecutionContract:z.literal(1).optional(),nodes:z.array(genericNode).min(1).max(32),edges:z.array(genericEdge).max(128),entryNodeId:bounded,terminalNodeId:bounded,maxStepExecutions:z.number().int().min(1).max(128)}).strict(),checkpointGateway:z.object({url:z.string().url().max(2048),authority:z.string().min(32).max(4096)}).strict(),interactionResume:z.object({interruptId:bounded,activationId:bounded,response:interactionResponseSchema}).strict().optional(),approvalResume:z.object({requestId:bounded,interruptId:bounded,approved:z.literal(true)}).strict().optional(),nodeGateway:z.union([z.object({url:z.string().url().max(2048)}).strict(),z.object({url:z.string().url().max(2048),authorities:z.array(exactAuthority).min(1).max(MAX_GRAPH_FRONTIER)}).strict()])}).strict();
export type GraphExecutionRequest=z.infer<typeof graphExecutionSchema>;
export type OutputRecord={activationId:string;nodeId:string;output?:string;sequence:number;route?:string};
type GraphActivity = Pick<OutputRecord, "activationId" | "nodeId" | "sequence" | "route">;
type RuntimePlan = GraphExecutionRequest["plan"];
type RuntimeNode = RuntimePlan["nodes"][number];
type GraphState={initialInput:string;outputs:OutputRecord[];executions:number};
const mergeOutputs=(left:OutputRecord[],right:OutputRecord[])=>{const map=new Map((Array.isArray(left)?left:[]).map(value=>[value.nodeId,value]));for(const value of Array.isArray(right)?right:[]){if(value.output===undefined)map.delete(value.nodeId);else map.set(value.nodeId,value);}return [...map.values()].sort((a,b)=>a.nodeId.localeCompare(b.nodeId))};
const GenericState=Annotation.Root({initialInput:Annotation<string>,outputs:Annotation<OutputRecord[]>({reducer:mergeOutputs,default:()=>[]}),executions:Annotation<number>({reducer:(left,right)=>left+right,default:()=>0}),
 // Consumers read the individual writes on the checkpoint lineage.
 activity:Annotation<GraphActivity,GraphActivity>({reducer:(_previous,current)=>current})});
export function evaluateCondition(config:{operator:"contains";value:string;caseSensitive:boolean},text:string){const subject=config.caseSensitive?text:text.toLocaleLowerCase("en-US"),value=config.caseSensitive?config.value:config.value.toLocaleLowerCase("en-US");return subject.includes(value)}
export function aggregateJoinInputs(inputs:Array<{sourceNodeId:string;output:string}>){const canonical={inputs:[...inputs].sort((a,b)=>a.sourceNodeId.localeCompare(b.sourceNodeId))},raw=JSON.stringify(canonical);if(Buffer.byteLength(raw,"utf8")>262_144)throw new Error("join_output_too_large");return raw}
function taskId(config:RunnableConfig){const value=config.configurable?.__pregel_task_id;if(typeof value!=="string"||!value)return "pure:"+crypto.randomUUID();return value}
function latestRecord(state:GraphState,nodeId:string){return state.outputs.filter(value=>value.nodeId===nodeId).sort((a,b)=>b.sequence-a.sequence||b.activationId.localeCompare(a.activationId))[0]}
function latestOutput(state:GraphState,nodeId:string){return latestRecord(state,nodeId)?.output}
function effectiveSources(plan:GraphExecutionRequest["plan"],nodeId:string,seen=new Set<string>()):string[]{if(seen.has(nodeId))return[];seen.add(nodeId);return [...new Set(plan.edges.filter(edge=>edge.target===nodeId).flatMap(edge=>{const source=plan.nodes.find(node=>node.id===edge.source);return source?.blockType==="condition"?effectiveSources(plan,source.id,seen):[edge.source]}))].sort()}
function publishes(plan:GraphExecutionRequest["plan"],nodeId:string){const node=plan.nodes.find(value=>value.id===nodeId);return node?.blockType==="agent"&&node.blockVersion===2&&node.config.context?.publishOutput===true}
function consumed(plan:GraphExecutionRequest["plan"],state:GraphState,nodeId:string){return effectiveSources(plan,nodeId).filter(source=>!publishes(plan,source)&&(latestRecord(state,source)?.route||plan.edges.filter(edge=>edge.source===source).length===1)).map(source=>({activationId:`consume:${source}`,nodeId:source,sequence:state.executions+1} as OutputRecord))}
function nodeInputRecord(plan: RuntimePlan, state: GraphState, nodeId: string) {
  function records(target: string, seen: Set<string>): OutputRecord[] {
    if (seen.has(target)) return [];
    seen.add(target);
    return plan.edges.filter(edge => edge.target === target).flatMap(edge => {
      const source = plan.nodes.find(node => node.id === edge.source);
      if (source?.blockType === "condition") return records(source.id, new Set(seen));
      const record = latestRecord(state, edge.source);
      return record && (!record.route || record.route === edge.sourcePort) ? [record] : [];
    });
  }
  return records(nodeId, new Set()).sort((a,b)=>b.sequence-a.sequence||b.activationId.localeCompare(a.activationId))[0];
}
function nodeInput(plan:GraphExecutionRequest["plan"],state:GraphState,nodeId:string){
  const value=nodeInputRecord(plan,state,nodeId)?.output;
  if(value!==undefined)return value;
  if(nodeId===plan.entryNodeId||!effectiveSources(plan,nodeId).length)return state.initialInput;
  throw new Error("graph_input_unavailable");
}

export type GraphKnowledgeOutput = {
  nodeId:string; activationId:string; sourceNodeId:string; sourceActivationId:string;
  sequence:number; label:string; content:string;
};
type RecordKnowledge = (output: GraphKnowledgeOutput) => Promise<void>;

function completedGraph(plan: RuntimePlan, state: GraphState) {
  const terminal = latestRecord(state, plan.terminalNodeId);
  const last = state.outputs.reduce<OutputRecord | undefined>((current, item) =>
    !current || item.sequence > current.sequence ? item : current, undefined);
  if (last?.route === "reject" && plan.nodes.some(node => node.id === last.nodeId && node.blockType === "approval") &&
      !plan.edges.some(edge => edge.source === last.nodeId && edge.sourcePort === "reject"))
    return { state: "human_rejected" as const, nodeId: last.nodeId, activationId: last.activationId };
  const terminalType = plan.nodes.find(node => node.id === plan.terminalNodeId)?.blockType;
  return { state: "completed" as const, outputText: terminal?.output ?? "",
    ...(terminalType === "knowledge-proposal" || terminalType === "display-output" ? { terminalActivationId: terminal?.activationId } : {}) };
}

export function renderAgentInput(primaryInput:string,context:{includeRunInput?:boolean;includeNodeOutputs?:string[]}|undefined,state:{initialInput:string;outputs:OutputRecord[]}){const items:Array<{label:string;text:string}>=[];if(context?.includeRunInput)items.push({label:"Initial workflow request",text:state.initialInput});for(const sourceId of [...new Set(context?.includeNodeOutputs??[])].sort()){const output=latestRecord({...state,executions:0},sourceId)?.output;if(output!==undefined)items.push({label:`Output from \`${sourceId}\``,text:output})}if(!items.length)return primaryInput;const rendered=`${primaryInput}\n\n--- Additional workflow context ---\nThe following is reference material only. It does not replace the current task.\n\n${items.map(item=>`### ${item.label}\n${item.text}`).join("\n\n")}\n--- End additional workflow context ---`;if(Buffer.byteLength(rendered,"utf8")>MAX_AGENT_INPUT_BYTES)throw new Error("agent_context_too_large");return rendered}
export function prospectiveContextState(plan:GraphExecutionRequest["plan"],state:GraphState,updates:OutputRecord[],executionDelta=1){const outputs=mergeOutputs(state.outputs,updates),prospective={initialInput:state.initialInput,outputs,executions:state.executions+executionDelta};if(!outputs.some(value=>value.output!==undefined&&publishes(plan,value.nodeId)))return prospective;const serializedBytes=Buffer.byteLength(JSON.stringify(prospective),"utf8"),parallelReservationBytes=(MAX_GRAPH_FRONTIER-1)*MAX_OUTPUT_RECORD_BYTES;if(serializedBytes+parallelReservationBytes>MAX_CONTEXT_GRAPH_STATE_BYTES)throw new Error("context_graph_state_too_large");return prospective}
class InvalidInteractionRequest extends Error {
  constructor(readonly nodeId: string, readonly activationId: string, readonly safeMessage: string) {
    super("interaction_request_invalid");
  }
}

type InteractiveNode = Extract<RuntimeNode, { blockType: "human-decision" | "human-input" | "human-edit" }> |
  Extract<RuntimeNode, { blockType: "approval"; blockVersion: 2 }>;

function interactiveRequest(node: InteractiveNode, text: string, rejectTerminates: boolean): InteractionRequest {
  const version = WORKFLOW_INTERACTION_VERSION;
  switch (node.blockType) {
    case "human-decision": {
      const config = node.config;
      if (config.source === "static") {
        return { version, kind: "decision", question: config.message, options: config.options,
          allowGuidance: config.allowGuidance, routing: config.routing };
      }
      if (Buffer.byteLength(text, "utf8") > MAX_DECISION_OPTION_BYTES) throw new Error("decision_options_invalid");
      const { message, options } = dynamicDecisionOptionsSchema.parse(JSON.parse(text));
      return { version, kind: "decision", question: message ?? config.message, options, allowGuidance: config.allowGuidance, routing: "data" };
    }
    case "human-input": {
      const { questionSource, question, ...config } = node.config;
      return { version, kind: "input", question: questionSource === "incoming" ? text : question!,
        sourceContext: text, ...config };
    }
    case "human-edit":
      return { version, kind: "edit", question: node.config.message, original: text };
    case "approval":
      return { version, kind: "approval", question: node.config.message, reviewed: text, outcomes: approvalOutcomes(node.config),
        requireRevisionFeedback: node.config.requireRevisionFeedback, rejectTerminates };
  }
}

function invokeInteraction(node: InteractiveNode, text: string, activity: GraphActivity, plan: RuntimePlan) {
  let request: InteractionRequest;
  try {
    request = interactionRequestSchema.parse(interactiveRequest(node, text, node.blockType === "approval" &&
      !plan.edges.some(edge => edge.source === node.id && edge.sourcePort === "reject")));
  } catch {
    const message = node.blockType === "human-decision" && node.config.source === "dynamic"
      ? "Human Decision expected valid option JSON from the preceding Agent. Return two to eight uniquely identified options with titles and values, within the decision size limit."
      : node.blockType === "human-input" && node.config.questionSource === "incoming"
        ? "Human Input expected a nonempty question within 2,000 UTF-8 bytes from the preceding block."
        : "The content sent for human review exceeds the interaction limit or contains invalid text.";
    throw new InvalidInteractionRequest(activity.nodeId, activity.activationId, message);
  }
  const { nodeId, activationId, sequence } = activity;
  const response = interrupt({ kind: "workflow-interaction", nodeId, activationId, sequence, request });
  return validateInteractionResponse(request, interactionResponseSchema.parse(response));
}

export function compileGenericStateGraph(
  plan: RuntimePlan,
  execute: (node: { id: string; agentId?: string }, input: string, activationId: string) => Promise<string>,
  checkpointer?: BaseCheckpointSaver,
  recordKnowledge?: RecordKnowledge,
) {
  const byId = new Map(plan.nodes.map(node => [node.id, node]));
  if (byId.size !== plan.nodes.length || !byId.has(plan.entryNodeId) || !byId.has(plan.terminalNodeId))
    throw new Error("langgraph_plan_invalid");
  let graph = new StateGraph(GenericState);
  const agentIds: string[] = [];
  for (const node of plan.nodes) {
    const edges = plan.edges.filter(edge => edge.source === node.id);
    if (node.blockType === "agent" || node.blockType === "publish-github-pr") agentIds.push(node.id);
    graph = graph.addNode(node.id, async (state: GraphState, config: RunnableConfig) => {
      if (state.executions >= plan.maxStepExecutions) throw new Error("execution_limit_exceeded");
      const activationId = taskId(config);
      const activity: GraphActivity = { activationId, nodeId: node.id, sequence: state.executions + 1 };
      const updates = (output: string, route?: string, remove = consumed(plan, state, node.id)) => {
        const result = { ...activity, ...(route ? { route } : {}) };
        const outputs = [...remove, { ...result, output }];
        prospectiveContextState(plan, state, outputs);
        return { outputs, executions: 1, activity: result };
      };
      if (node.blockType === "join") {
        const sources = [...new Set(plan.edges.filter(edge => edge.target === node.id).map(edge => edge.source))];
        const output = aggregateJoinInputs(sources.map(sourceNodeId => {
          const output = latestOutput(state, sourceNodeId);
          if (output === undefined) throw new Error("join_input_unavailable");
          return { sourceNodeId, output };
        }));
        const deletions = state.outputs.filter(value => value.nodeId !== node.id && !publishes(plan, value.nodeId))
          .map(value => ({ activationId: `consume:${value.nodeId}`, nodeId: value.nodeId, sequence: activity.sequence }));
        return updates(output, undefined, deletions);
      }
      const primary = nodeInput(plan, state, node.id);
      if (node.blockType === "agent" || node.blockType === "publish-github-pr") {
        const input = node.blockType === "agent" && node.blockVersion === 2 ? renderAgentInput(primary, node.config.context, state) : primary;
        const output = await execute({ id: node.id, ...(node.blockType === "agent" ? { agentId: node.config.agentId } : {}) }, input, activationId);
        return updates(output);
      }
      if (node.blockType === "condition") {
        const route = evaluateCondition(node.config, primary) ? "true" : "false";
        return { executions: 1, activity: { ...activity, route } };
      }
      if (node.blockType === "knowledge-proposal") {
        if (!recordKnowledge) throw new Error("knowledge_action_unavailable");
        const source = nodeInputRecord(plan, state, node.id);
        if (!source || source.output === undefined) throw new Error("knowledge_source_unavailable");
        const output = updates(source.output);
        await recordKnowledge({ ...activity, sourceNodeId: source.nodeId, sourceActivationId: source.activationId,
          label: node.config.label ?? "Knowledge finding", content: source.output });
        return output;
      }
      if (node.blockType === "display-output") return updates(primary);
      if (node.blockType === "approval" && node.blockVersion === 1) {
        const decision = interrupt({ kind: "approval", nodeId: node.id, activationId, message: node.config.message, text: primary });
        if (decision !== true) throw new Error("approval_resume_invalid");
        return updates(primary);
      }
      const { output, route } = invokeInteraction(node, primary, activity, plan);
      // A terminal rejection records the outcome without handing reviewed content to another block.
      return updates(route === "reject" && !edges.some(edge => edge.sourcePort === "reject") ? "" : output, route);
    }) as typeof graph;
  }
  graph = graph.addEdge(START, plan.entryNodeId as "__start__") as typeof graph;
  for (const node of plan.nodes) {
    const edges = plan.edges.filter(edge => edge.source === node.id && byId.get(edge.target)?.blockType !== "join");
    const routes = Object.fromEntries(edges.map(edge => [edge.sourcePort, edge.target]));
    if (node.blockType === "condition") {
      graph = graph.addConditionalEdges(node.id as "__start__", (state: GraphState) =>
        evaluateCondition(node.config, nodeInput(plan, state, node.id)) ? "true" : "false", routes as Record<string, "__end__">) as typeof graph;
    } else if (node.blockType === "approval" && node.blockVersion === 2 ||
      node.blockType === "human-decision" && node.config.source === "static" && node.config.routing === "branches") {
      if (node.blockType === "approval" && node.config.allowReject && !routes.reject) routes.reject = END;
      graph = graph.addConditionalEdges(node.id as "__start__", (state: GraphState) => {
        const route = latestRecord(state, node.id)?.route;
        if (!route || !Object.hasOwn(routes, route)) throw new Error("interaction_route_invalid");
        return route;
      }, routes as Record<string, "__end__">) as typeof graph;
    } else {
      for (const edge of edges) graph = graph.addEdge(node.id as "__start__", edge.target as "__start__") as typeof graph;
    }
  }
  for (const join of plan.nodes.filter(node => node.blockType === "join")) {
    const sources = [...new Set(plan.edges.filter(edge => edge.target === join.id).map(edge => edge.source))] as "__start__"[];
    graph = graph.addEdge(sources, join.id as "__start__") as typeof graph;
  }
  graph = graph.addEdge(plan.terminalNodeId as "__start__", END) as typeof graph;
  return graph.compile({ checkpointer, interruptBefore: agentIds as "__start__"[] });
}

type InterruptSnapshot = { tasks?: Array<{ interrupts?: Array<{ id?: string; value?: unknown }> }> };
function pendingInteraction(snapshot: InterruptSnapshot) {
  const values = (snapshot.tasks ?? []).flatMap(task => task.interrupts ?? []).filter(item =>
    item.value && typeof item.value === "object" && ["approval", "workflow-interaction"].includes(String((item.value as { kind?: unknown }).kind)));
  if (values.length > 1) throw new Error("multiple_approval_interrupts");
  const item = values[0];
  if (!item) return;
  const value = item.value as { kind: string; nodeId: string; activationId: string; message: string; text: string };
  const interruptId = item.id ?? value.activationId;
  if (value.kind === "workflow-interaction") {
    const { nodeId, activationId, sequence, request } = graphInteractionSchema.parse(item.value);
    return { state: "interaction_required" as const, interruptId, nodeId, activationId, sequence, request };
  }
  return { state: "approval_required" as const, interruptId, nodeId: String(value.nodeId),
    activationId: String(value.activationId), message: String(value.message), text: String(value.text) };
}

function graphErrorIncludes(error: unknown, message: string): boolean {
  return error instanceof Error && (error.message === message ||
    (error instanceof AggregateError && error.errors.some(value => graphErrorIncludes(value, message))));
}

export async function advanceGenericGraph(request: GraphExecutionRequest, fetcher: typeof fetch = fetch, recordKnowledge?: RecordKnowledge) {
  const parsed = graphExecutionSchema.parse(request);
  const config = { configurable: { thread_id: parsed.runId }, recursionLimit: parsed.plan.maxStepExecutions + 2 };
  const saver = new RemoteCheckpointSaver(safeGatewayUrl(parsed.checkpointGateway.url), parsed.checkpointGateway.authority, parsed.runId, fetcher);
  const authorities = "authorities" in parsed.nodeGateway
    ? new Map(parsed.nodeGateway.authorities.map(value => [`${value.nodeId}:${value.activationId}`, value])) : undefined;
  const execute = async (node: { id: string }, input: string, activationId: string) => {
    const exact = authorities?.get(`${node.id}:${activationId}`);
    if (!exact) throw new GraphNodeGatewayFailure("invalid");
    let response: Response;
    try {
      response = await fetcher(safeGatewayUrl(parsed.nodeGateway.url), { method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${exact.authority}` },
        body: JSON.stringify({ runId: parsed.runId, nodeId: node.id, activationId, workflowGeneration: exact.workflowGeneration,
          iteration: exact.iteration, attempt: exact.attempt, inputText: input }), signal: AbortSignal.timeout(GRAPH_NODE_GATEWAY_TIMEOUT_MS) });
    } catch (error) {
      throw new GraphNodeGatewayFailure("unavailable", undefined, callbackTransportOutcome(error));
    }
    return graphNodeResponse(response);
  };
  const graph = compileGenericStateGraph(parsed.plan, execute, saver, recordKnowledge);
  const agentNames = new Set(parsed.plan.nodes.filter(node => node.blockType === "agent" || node.blockType === "publish-github-pr").map(node => node.id));
  const executionLimit = { state: "execution_limit" as const, safeMessage: "The workflow execution limit was reached." };
  try {
    const existing = await saver.getTuple(config);
    if (!authorities && !existing) await graph.invoke({ initialInput: parsed.initialInput, outputs: [], executions: 0 }, config);
    let approvalResume = parsed.approvalResume;
    let interactionResume = parsed.interactionResume;
    for (;;) {
      const snapshot = await graph.getState(config);
      const waiting = pendingInteraction(snapshot);
      const latestTuple = await saver.getTuple(config);
      const successfulTaskIds = new Set((latestTuple?.pendingWrites ?? []).filter(([, channel]) => channel !== "__error__").map(([id]) => id));
      const frontier = snapshot.tasks.filter(task => agentNames.has(task.name) && task.result === undefined && !successfulTaskIds.has(task.id))
        .map(task => ({ nodeId: task.name, activationId: task.id }))
        .sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.activationId.localeCompare(b.activationId));
      if (authorities) {
        if (authorities.size !== frontier.length || frontier.some(item => !authorities.has(`${item.nodeId}:${item.activationId}`)))
          throw new GraphNodeGatewayFailure("invalid");
        const result = await graph.invoke(null, config);
        const after = await graph.getState(config);
        const afterWaiting = pendingInteraction(after);
        if (afterWaiting) return afterWaiting;
        const remaining = after.tasks.filter(task => agentNames.has(task.name) && task.result === undefined);
        return remaining.length ? { state: "advanced" as const, outputText: latestOutput(result as GraphState, parsed.plan.terminalNodeId),
          frontier: remaining.map(task => ({ nodeId: task.name, activationId: task.id })) }
          : completedGraph(parsed.plan, result as GraphState);
      }
      if (waiting?.state === "approval_required" && approvalResume?.interruptId === waiting.interruptId) {
        approvalResume = undefined;
        await graph.invoke(new Command({ resume: true }), config);
        continue;
      }
      if (waiting?.state === "interaction_required" && interactionResume?.interruptId === waiting.interruptId &&
          interactionResume.activationId === waiting.activationId) {
        const { response } = interactionResume;
        interactionResume = undefined;
        validateInteractionResponse(waiting.request, response);
        await graph.invoke(new Command({ resume: { [waiting.interruptId]: response } }), config);
        continue;
      }
      if (waiting) return waiting;
      if (frontier.length > MAX_GRAPH_FRONTIER) return { state: "graph_failure" as const, failureCode: "configuration_invalid" as const,
        safeMessage: "The graph frontier exceeds the supported concurrency bound." };
      if (Number(snapshot.values.executions ?? 0) + frontier.length > parsed.plan.maxStepExecutions) return executionLimit;
      if (frontier.length) return { state: "admission_required" as const, frontier };
      if (!snapshot.next.length) return completedGraph(parsed.plan, snapshot.values as GraphState);
      if (Number(snapshot.values.executions ?? 0) + snapshot.tasks.length > parsed.plan.maxStepExecutions) return executionLimit;
      await graph.invoke(null, config);
    }
  } catch (error) {
    if (error instanceof NodePending) return { state: error.state, safeMessage: error.safeMessage, retryAfterMs: error.retryAfterMs };
    if (error instanceof Error && error.message.includes("execution_limit")) return executionLimit;
    if (error instanceof InvalidInteractionRequest) return { state: "graph_failure" as const, failureCode: "configuration_invalid" as const,
      safeMessage: error.safeMessage, nodeId: error.nodeId, activationId: error.activationId };
    const limits = {
      join_output_too_large: "Join output exceeds the allowed size.",
      agent_context_too_large: "Selected Workflow context exceeds the Agent input limit",
      context_graph_state_too_large: "Workflow context exceeds the safe checkpoint state limit",
    };
    for (const [code, safeMessage] of Object.entries(limits)) {
      if (graphErrorIncludes(error, code)) return { state: "graph_failure" as const, failureCode: "output_too_large" as const, safeMessage };
    }
    throw error;
  }
}
