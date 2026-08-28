import { z } from "zod";
import { validateAdapterOptions } from "./workflow-adapter.ts";
import {validateOpenAIModelAgentOptions} from "./openai-model-agent-capabilities.ts";
import {workflowBlockRegistry} from "./workflow-block-registry.ts";

export const DEFINITION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_WORKFLOW_STEPS = 32;
export const MAX_STEP_EXECUTIONS = 128;

const id = z.string().regex(DEFINITION_ID).max(80);
const credentialKey = /(?:credential|password|secret|token|api.?key|private.?key)/i;

export const AGENT_MASTER_PROMPT_MAX_LENGTH=65536;
export const agentToolSchema=z.enum(["artifact_search"]);
const agentBase={id,name:z.string().trim().min(1).max(120),description:z.string().max(2000),status:z.literal("draft"),connectionKey:id,tools:z.array(agentToolSchema).max(1).optional(),adapterOptions:z.unknown().optional()};
const agentV1Schema=z.object({schemaVersion:z.literal(1),...agentBase,masterPrompt:z.string().min(1).max(AGENT_MASTER_PROMPT_MAX_LENGTH)}).strict();
const agentV2Schema=z.object({schemaVersion:z.literal(2),...agentBase,prompt:z.discriminatedUnion("source",[
  z.object({source:z.literal("custom"),text:z.string().min(1).max(AGENT_MASTER_PROMPT_MAX_LENGTH)}).strict(),
  z.object({source:z.literal("artifact"),artifactId:id}).strict(),
])}).strict();
const withCompatibilityPrompt=(value:z.infer<typeof agentV2Schema>)=>({...value,masterPrompt:value.prompt.source==="custom"?value.prompt.text:""});
const compatibleV2Schema=agentV2Schema.extend({masterPrompt:z.string()});
export const agentDefinitionSchema = z.union([agentV1Schema,agentV2Schema,compatibleV2Schema]).transform(value=>{if(value.schemaVersion===2){const clean={...value} as z.infer<typeof compatibleV2Schema>;delete (clean as {masterPrompt?:string}).masterPrompt;return withCompatibilityPrompt(clean)}const {masterPrompt,...rest}=value;return withCompatibilityPrompt({...rest,schemaVersion:2 as const,prompt:{source:"custom" as const,text:masterPrompt}})}).pipe(z.object({
  schemaVersion:z.literal(2),...agentBase,prompt:agentV2Schema.shape.prompt,masterPrompt:z.string()
})).superRefine((value, context) => {
  const visit = (item: unknown, path: PropertyKey[] = []) => {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (key!=="maxOutputTokens"&&credentialKey.test(key)) context.addIssue({ code: "custom", message: "Credential-like fields are not permitted.", path: [...path, key] as (string | number)[] });
      visit(child, [...path, key]);
    }
  };
  visit(value.adapterOptions, ["adapterOptions"]);
});

export const workflowStepSchema = z.object({
  id, name: z.string().trim().min(1).max(120), agentId: id,
  input: z.discriminatedUnion("source", [z.object({ source: z.literal("run_input") }).strict(), z.object({ source: z.literal("previous_step") }).strict()]),
  onSuccess: z.discriminatedUnion("type", [z.object({ type: z.literal("next") }).strict(), z.object({ type: z.literal("complete") }).strict()]),
  onFailure: z.object({ type: z.literal("fail") }).strict(),
}).strict();

export const workflowDefinitionV1Schema = z.object({
  schemaVersion: z.literal(1), id, name: z.string().trim().min(1).max(120), description: z.string().max(2000), status: z.literal("draft"),
  steps: z.array(workflowStepSchema).min(1).max(MAX_WORKFLOW_STEPS),
  result: z.object({ source: z.literal("step_output"), stepId: id }).strict(),
  limits: z.object({ maxStepExecutions: z.number().int().min(1).max(MAX_STEP_EXECUTIONS) }).strict(),
}).strict().superRefine((workflow, context) => {
  const ids = new Set<string>();
  workflow.steps.forEach((step, index) => {
    if (ids.has(step.id)) context.addIssue({ code: "custom", message: "Step IDs must be unique.", path: ["steps", index, "id"] });
    ids.add(step.id);
    const expectedInput = index === 0 ? "run_input" : "previous_step";
    const expectedSuccess = index === workflow.steps.length - 1 ? "complete" : "next";
    if (step.input.source !== expectedInput) context.addIssue({ code: "custom", message: `Step ${index + 1} must use ${expectedInput}.`, path: ["steps", index, "input"] });
    if (step.onSuccess.type !== expectedSuccess) context.addIssue({ code: "custom", message: `Step ${index + 1} must ${expectedSuccess}.`, path: ["steps", index, "onSuccess"] });
  });
  if (!ids.has(workflow.result.stepId)) context.addIssue({ code: "custom", message: "Result step does not exist.", path: ["result", "stepId"] });
  if (workflow.result.stepId !== workflow.steps.at(-1)?.id) context.addIssue({ code: "custom", message: "Result must use the final step.", path: ["result", "stepId"] });
  if (workflow.limits.maxStepExecutions < workflow.steps.length) context.addIssue({ code: "custom", message: "Execution limit is lower than the step count.", path: ["limits", "maxStepExecutions"] });
});

const workflowNodeSchema=z.object({id,blockType:z.string().trim().min(1).max(80),blockVersion:z.number().int().positive(),config:z.unknown()}).strict();
const workflowEdgeSchema=z.object({id,source:z.string().regex(DEFINITION_ID).max(80),target:z.string().regex(DEFINITION_ID).max(80)}).strict();
export const workflowDefinitionV2Schema=z.object({schemaVersion:z.literal(2),id,name:z.string().trim().min(1).max(120),description:z.string().max(2000),status:z.literal("draft"),nodes:z.array(workflowNodeSchema).min(1).max(MAX_WORKFLOW_STEPS),edges:z.array(workflowEdgeSchema).max(MAX_WORKFLOW_STEPS-1),limits:z.object({maxStepExecutions:z.number().int().min(1).max(MAX_STEP_EXECUTIONS)}).strict()}).strict().superRefine((workflow,context)=>{
 const nodeIds=new Set<string>(),edgeIds=new Set<string>();
 workflow.nodes.forEach((node,index)=>{if(nodeIds.has(node.id))context.addIssue({code:"custom",message:"Node IDs must be unique.",path:["nodes",index,"id"]});nodeIds.add(node.id);try{workflowBlockRegistry.validate(node.blockType,node.blockVersion,node.config)}catch(error){context.addIssue({code:"custom",message:error instanceof Error?error.message:"Invalid block configuration.",path:["nodes",index,"config"]})}});
 workflow.edges.forEach((edge,index)=>{if(edgeIds.has(edge.id))context.addIssue({code:"custom",message:"Edge IDs must be unique.",path:["edges",index,"id"]});edgeIds.add(edge.id);if(!nodeIds.has(edge.source)||!nodeIds.has(edge.target))context.addIssue({code:"custom",message:"Edge endpoints must exist.",path:["edges",index]})});
 if(workflow.limits.maxStepExecutions<workflow.nodes.length)context.addIssue({code:"custom",message:"Execution limit is lower than the node count.",path:["limits","maxStepExecutions"]});
});
export const workflowDefinitionSchema=z.discriminatedUnion("schemaVersion",[workflowDefinitionV1Schema,workflowDefinitionV2Schema]);

export type AgentPrompt=z.infer<typeof agentV2Schema>["prompt"];
export type AgentDefinitionV1 = z.infer<typeof agentDefinitionSchema>;
export type WorkflowDefinitionV1 = z.infer<typeof workflowDefinitionV1Schema>;
export type WorkflowDefinitionV2 = z.infer<typeof workflowDefinitionV2Schema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowV2ExecutionPlan={nodes:Array<{id:string;agentId:string}>;edges:Array<{source:string;target:string}>;entryNodeId:string;terminalNodeId:string;maxStepExecutions:number};

export function validateAgentAdapterOptions(agent:AgentDefinitionV1,adapter:string){return {...agent,adapterOptions:validateAdapterOptions(adapter,agent.adapterOptions)};}
export function validateAgentForConnection(agent:AgentDefinitionV1,connection:{adapter:string;defaultModel?:string}){const definition=validateAgentAdapterOptions(agent,connection.adapter);if(definition.tools?.length&&connection.adapter!=="openai-agents")throw new Error("agent_tool_runtime_unsupported");if(connection.adapter==="openai-responses"||connection.adapter==="openai-agents")validateOpenAIModelAgentOptions(connection.defaultModel,definition.adapterOptions as import("./workflow-adapter.ts").OpenAIResponsesOptions);return definition;}

export const agentDefinitionPath = (idValue: string, root = "agents") => `${root.replace(/^\/+|\/+$/g, "")}/${id.parse(idValue)}.agent.json`;
export const workflowDefinitionPath = (idValue: string, root = "workflows") => `${root.replace(/^\/+|\/+$/g, "")}/${id.parse(idValue)}.workflow.json`;

/** Canonical UTF-8 representation used in Git and immutable run snapshots. */
export function canonicalJson(value: unknown) {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([key, child]) => child !== undefined && !(key==="masterPrompt"&&(item as Record<string,unknown>).schemaVersion===2)).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : item;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export function buildSequentialWorkflow(input: { id: string; name: string; description?: string; agents: Array<{ id: string; name: string }>; maxStepExecutions?: number }): WorkflowDefinitionV1 {
  const steps = input.agents.map((agent, index, all) => ({ id: `step-${index + 1}`, name: agent.name, agentId: agent.id,
    input: { source: index === 0 ? "run_input" as const : "previous_step" as const },
    onSuccess: { type: index === all.length - 1 ? "complete" as const : "next" as const }, onFailure: { type: "fail" as const } }));
  return workflowDefinitionV1Schema.parse({ schemaVersion: 1, id: input.id, name: input.name, description: input.description ?? "", status: "draft", steps,
    result: { source: "step_output", stepId: steps.at(-1)?.id }, limits: { maxStepExecutions: input.maxStepExecutions ?? Math.max(steps.length, 32) } });
}

export function workflowAgentReferences(workflow:WorkflowDefinition){return workflow.schemaVersion===1?workflow.steps.map(step=>step.agentId):workflow.nodes.map(node=>(workflowBlockRegistry.validate(node.blockType,node.blockVersion,node.config) as {agentId:string}).agentId);}

export function compileWorkflowV2(workflow:WorkflowDefinitionV2,agents:readonly AgentDefinitionV1[]):WorkflowDefinitionV1{
 const parsed=workflowDefinitionV2Schema.parse(workflow),byId=new Map(parsed.nodes.map(node=>[node.id,node])),incoming=new Map(parsed.nodes.map(node=>[node.id,0])),outgoing=new Map(parsed.nodes.map(node=>[node.id,[] as string[]]));
 for(const edge of parsed.edges){incoming.set(edge.target,(incoming.get(edge.target)??0)+1);outgoing.get(edge.source)!.push(edge.target);}
 if([...incoming.values()].some(value=>value>1))throw new Error("unsupported_workflow_topology:joins_not_supported");
 if([...outgoing.values()].some(value=>value.length>1))throw new Error("unsupported_workflow_topology:branching_not_supported");
 const entries=[...incoming].filter(([,value])=>value===0).map(([key])=>key),terminals=[...outgoing].filter(([,value])=>value.length===0).map(([key])=>key);
 if(entries.length!==1)throw new Error("unsupported_workflow_topology:ambiguous_entry");if(terminals.length!==1)throw new Error("unsupported_workflow_topology:ambiguous_terminal");
 const order:string[]=[];let cursor:string|undefined=entries[0];while(cursor&&!order.includes(cursor)){order.push(cursor);cursor=outgoing.get(cursor)?.[0];}
 if(cursor)throw new Error("unsupported_workflow_topology:cycle");if(order.length!==parsed.nodes.length)throw new Error("unsupported_workflow_topology:disconnected");
 const agentById=new Map(agents.map(agent=>[agent.id,agent]));
 return workflowDefinitionV1Schema.parse({schemaVersion:1,id:parsed.id,name:parsed.name,description:parsed.description,status:parsed.status,steps:order.map((nodeId,index)=>{const node=byId.get(nodeId)!,config=workflowBlockRegistry.validate(node.blockType,node.blockVersion,node.config) as {agentId:string},agent=agentById.get(config.agentId);if(!agent)throw new Error(`missing_agent:${config.agentId}`);return{id:node.id,name:agent.name,agentId:agent.id,input:{source:index===0?"run_input":"previous_step"},onSuccess:{type:index===order.length-1?"complete":"next"},onFailure:{type:"fail"}}}),result:{source:"step_output",stepId:order.at(-1)},limits:parsed.limits});
}

/** Immutable ADT-owned plan used to reconstruct the Runtime graph without persisting LangGraph models. */
export function compileWorkflowV2ExecutionPlan(workflow:WorkflowDefinitionV2,agents:readonly AgentDefinitionV1[]):WorkflowV2ExecutionPlan{
 const sequential=compileWorkflowV2(workflow,agents);
 return{nodes:sequential.steps.map(step=>({id:step.id,agentId:step.agentId})),edges:workflow.edges.map(edge=>({source:edge.source,target:edge.target})),entryNodeId:sequential.steps[0].id,terminalNodeId:sequential.steps.at(-1)!.id,maxStepExecutions:workflow.limits.maxStepExecutions};
}

export function executableWorkflow(workflow:WorkflowDefinition,agents:readonly AgentDefinitionV1[]){return workflow.schemaVersion===1?workflow:compileWorkflowV2(workflow,agents);}

export async function validateWorkflowReferences(workflow: WorkflowDefinition, agents: readonly AgentDefinitionV1[], availableConnections: ReadonlySet<string>) {
  if(workflow.schemaVersion===2)compileWorkflowV2(workflow,agents);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  for (const agentId of workflowAgentReferences(workflow)) {
    const agent = byId.get(agentId);
    if (!agent) throw new Error(`missing_agent:${agentId}`);
    if (!availableConnections.has(agent.connectionKey)) throw new Error(`connection_unavailable:${agent.connectionKey}`);
  }
}

export function validateTerminalCodexSteps(workflow:WorkflowDefinitionV1,agents:readonly AgentDefinitionV1[],adapterForConnection:(key:string)=>string|undefined){const byId=new Map(agents.map(agent=>[agent.id,agent]));workflow.steps.forEach((step,index)=>{const agent=byId.get(step.agentId);if(agent&&adapterForConnection(agent.connectionKey)==="codex-cloud"&&index!==workflow.steps.length-1)throw new Error("codex_cloud_terminal_only");});}
