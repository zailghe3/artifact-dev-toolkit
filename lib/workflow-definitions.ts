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
export const historicalAgentDefinitionV1Schema=z.object({schemaVersion:z.literal(1),...agentBase,masterPrompt:z.string().min(1).max(AGENT_MASTER_PROMPT_MAX_LENGTH)}).strict();
const agentV2Schema=z.object({schemaVersion:z.literal(2),...agentBase,prompt:z.discriminatedUnion("source",[
  z.object({source:z.literal("custom"),text:z.string().min(1).max(AGENT_MASTER_PROMPT_MAX_LENGTH)}).strict(),
  z.object({source:z.literal("artifact"),artifactId:id}).strict(),
])}).strict();
export const persistedAgentDefinitionSchema=agentV2Schema.superRefine((value, context) => {
  const visit = (item: unknown, path: PropertyKey[] = []) => {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (key!=="maxOutputTokens"&&credentialKey.test(key)) context.addIssue({ code: "custom", message: "Credential-like fields are not permitted.", path: [...path, key] as (string | number)[] });
      visit(child, [...path, key]);
    }
  };
  visit(value.adapterOptions, ["adapterOptions"]);
});
export type PersistedAgentDefinition=z.infer<typeof persistedAgentDefinitionSchema>;
export const hydrateAgentDefinition=(value:PersistedAgentDefinition)=>({...value,masterPrompt:value.prompt.source==="custom"?value.prompt.text:""});
export const agentDefinitionSchema=persistedAgentDefinitionSchema.transform(hydrateAgentDefinition);

export const historicalWorkflowStepSchema = z.object({
  id, name: z.string().trim().min(1).max(120), agentId: id,
  input: z.discriminatedUnion("source", [z.object({ source: z.literal("run_input") }).strict(), z.object({ source: z.literal("previous_step") }).strict()]),
  onSuccess: z.discriminatedUnion("type", [z.object({ type: z.literal("next") }).strict(), z.object({ type: z.literal("complete") }).strict()]),
  onFailure: z.object({ type: z.literal("fail") }).strict(),
}).strict();

export const historicalWorkflowDefinitionV1Schema = z.object({
  schemaVersion: z.literal(1), id, name: z.string().trim().min(1).max(120), description: z.string().max(2000), status: z.literal("draft"),
  steps: z.array(historicalWorkflowStepSchema).min(1).max(MAX_WORKFLOW_STEPS),
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
const workflowEdgeSchema=z.object({id,source:id,sourcePort:id.optional(),target:id,targetPort:id.optional()}).strict();

function validateGraphTopology(workflow:{nodes:Array<{id:string;blockType:string;blockVersion:number;config:unknown}>;edges:Array<{source:string;sourcePort?:string;target:string;targetPort?:string}>},context:z.RefinementCtx){
 const byId=new Map(workflow.nodes.map(node=>[node.id,node])),incoming=new Map(workflow.nodes.map(node=>[node.id,[] as typeof workflow.edges])),outgoing=new Map(workflow.nodes.map(node=>[node.id,[] as typeof workflow.edges])),semantic=new Set<string>();
 workflow.edges.forEach((edge,index)=>{const source=byId.get(edge.source),target=byId.get(edge.target);if(!source||!target){context.addIssue({code:"custom",message:"Edge endpoints must exist.",path:["edges",index]});return}let sourcePort:string,targetPort:string;try{sourcePort=workflowBlockRegistry.port(source.blockType,source.blockVersion,"outputs",edge.sourcePort);targetPort=workflowBlockRegistry.port(target.blockType,target.blockVersion,"inputs",edge.targetPort)}catch(error){context.addIssue({code:"custom",message:error instanceof Error?error.message:"Invalid edge port.",path:["edges",index]});return}const key=`${edge.source}:${sourcePort}->${edge.target}:${targetPort}`;if(semantic.has(key))context.addIssue({code:"custom",message:"Duplicate semantic edges are not permitted.",path:["edges",index]});semantic.add(key);incoming.get(edge.target)!.push({...edge,sourcePort,targetPort});outgoing.get(edge.source)!.push({...edge,sourcePort,targetPort})});
 const roots=[...incoming].filter(([,edges])=>edges.length===0).map(([key])=>key),cycleRoots=workflow.edges.filter(edge=>byId.get(edge.source)?.blockType==="condition"&&(()=>{const seen=new Set<string>();const reaches=(id:string):boolean=>{if(id===edge.source)return true;if(seen.has(id))return false;seen.add(id);return(outgoing.get(id)??[]).some(next=>reaches(next.target))};return reaches(edge.target)})()).map(edge=>edge.target),entries=roots.length?roots:[...new Set(cycleRoots)],terminals=[...outgoing].filter(([,edges])=>edges.length===0).map(([key])=>key);if(entries.length!==1)context.addIssue({code:"custom",message:"Workflow must have exactly one graph entry.",path:["edges"]});if(terminals.length!==1)context.addIssue({code:"custom",message:"Workflow must have exactly one successful terminal.",path:["edges"]});
 for(const [nodeId,node] of byId){const ins=incoming.get(nodeId)!,outs=outgoing.get(nodeId)!;if(node.blockType==="condition"){if(ins.length!==1)context.addIssue({code:"custom",message:"Condition must have exactly one input.",path:["nodes",workflow.nodes.indexOf(node)]});const ports=outs.map(edge=>edge.sourcePort);if(outs.length!==2||ports.filter(port=>port==="true").length!==1||ports.filter(port=>port==="false").length!==1)context.addIssue({code:"custom",message:"Condition must have exactly one true route and one false route.",path:["nodes",workflow.nodes.indexOf(node)]});}else if(node.blockType==="join"){if(ins.length<2)context.addIssue({code:"custom",message:"Join must have at least two incoming branches.",path:["nodes",workflow.nodes.indexOf(node)]});if(outs.length!==1)context.addIssue({code:"custom",message:"Join must have exactly one outgoing route.",path:["nodes",workflow.nodes.indexOf(node)]});const predecessors=ins.map(edge=>edge.source),origins=predecessors.map(source=>{const sourceIncoming=incoming.get(source)??[];return sourceIncoming.length===1?sourceIncoming[0].source:undefined}),origin=origins[0],structured=Boolean(origin&&origins.every(value=>value===origin)&&byId.get(origin)?.blockType!=="condition"&&(outgoing.get(origin)??[]).length===predecessors.length&&predecessors.every(source=>(outgoing.get(source)??[]).length===1&&(outgoing.get(source)??[])[0].target===nodeId));if(!structured)context.addIssue({code:"custom",message:"Join must close one direct structured parallel fan-out.",path:["nodes",workflow.nodes.indexOf(node)]});}else if(ins.length>1){const controlledCycleMerge=ins.some(incomingEdge=>{const seen=new Set<string>();const reaches=(current:string,hasCondition:boolean):boolean=>{if(current===incomingEdge.source)return hasCondition||byId.get(current)?.blockType==="condition";if(seen.has(current))return false;seen.add(current);return(outgoing.get(current)??[]).some(next=>reaches(next.target,hasCondition||byId.get(current)?.blockType==="condition"))};return reaches(nodeId,false)});const exclusive=[...byId.values()].some(candidate=>candidate.blockType==="condition"&&["true","false"].every(port=>{const start=outgoing.get(candidate.id)?.find(edge=>edge.sourcePort===port)?.target;if(!start)return false;const seen=new Set<string>();const visit=(id:string):boolean=>{if(ins.some(edge=>edge.source===id))return true;if(seen.has(id)||id===nodeId)return false;seen.add(id);return(outgoing.get(id)??[]).some(edge=>visit(edge.target))};return visit(start)}));if(!exclusive&&!controlledCycleMerge)context.addIssue({code:"custom",message:"Only Join may receive multiple parallel edges.",path:["nodes",workflow.nodes.indexOf(node)]});}
  if(node.blockType!=="condition"&&outs.length>3)context.addIssue({code:"custom",message:"Fan-out exceeds the supported concurrency bound.",path:["nodes",workflow.nodes.indexOf(node)]});if(node.blockType!=="condition"&&outs.length>1){const joinsFor=(start:string)=>{const found=new Set<string>(),seen=new Set<string>();const visit=(id:string)=>{if(seen.has(id))return;seen.add(id);if(byId.get(id)?.blockType==="join"){found.add(id);return}for(const edge of outgoing.get(id)??[])visit(edge.target)};visit(start);return found};const sets=outs.map(edge=>joinsFor(edge.target)),common=[...(sets[0]??[])].filter(join=>sets.every(set=>set.has(join)));if(!common.length)context.addIssue({code:"custom",message:"Fan-out branches must reconverge at an explicit Join.",path:["nodes",workflow.nodes.indexOf(node)]});else{const join=common[0],containsApproval=(start:string,seen=new Set<string>()):boolean=>{if(start===join||seen.has(start))return false;seen.add(start);if(byId.get(start)?.blockType==="approval")return true;return(outgoing.get(start)??[]).some(edge=>containsApproval(edge.target,seen))};if(outs.some(edge=>containsApproval(edge.target)))context.addIssue({code:"custom",message:"Approval is not supported inside a structured parallel fan-out.",path:["nodes",workflow.nodes.indexOf(node)]});}}}
 if(terminals.length===1){const terminalType=byId.get(terminals[0])?.blockType;if(terminalType!=="agent"&&terminalType!=="subworkflow")context.addIssue({code:"custom",message:"The successful terminal must be an Agent or reusable Workflow.",path:["nodes"]});}
 if(entries.length===1){const reachable=new Set<string>();const visit=(nodeId:string)=>{if(reachable.has(nodeId))return;reachable.add(nodeId);for(const edge of outgoing.get(nodeId)??[])visit(edge.target)};visit(entries[0]);if(reachable.size!==workflow.nodes.length)context.addIssue({code:"custom",message:"All nodes must be reachable from the graph entry.",path:["edges"]});}
 if(terminals.length===1){const leads=new Set<string>();const reverse=(nodeId:string)=>{if(leads.has(nodeId))return;leads.add(nodeId);for(const edge of incoming.get(nodeId)??[])reverse(edge.source)};reverse(terminals[0]);if(leads.size!==workflow.nodes.length)context.addIssue({code:"custom",message:"All nodes must structurally lead to the terminal.",path:["edges"]});}
 // Tarjan SCC validation permits only Condition-controlled cyclic regions with a structural exit.
 let index=0;const indexes=new Map<string,number>(),low=new Map<string,number>(),stack:string[]=[],onStack=new Set<string>();const components:string[][]=[];const strong=(id:string)=>{indexes.set(id,index);low.set(id,index++);stack.push(id);onStack.add(id);for(const edge of outgoing.get(id)??[]){if(!indexes.has(edge.target)){strong(edge.target);low.set(id,Math.min(low.get(id)!,low.get(edge.target)!))}else if(onStack.has(edge.target))low.set(id,Math.min(low.get(id)!,indexes.get(edge.target)!))}if(low.get(id)===indexes.get(id)){const component:string[]=[];let value:string;do{value=stack.pop()!;onStack.delete(value);component.push(value)}while(value!==id);components.push(component)}};for(const id of byId.keys())if(!indexes.has(id))strong(id);for(const component of components){const cyclic=component.length>1||(outgoing.get(component[0])??[]).some(edge=>edge.target===component[0]);if(!cyclic)continue;const ids=new Set(component),hasCondition=component.some(id=>byId.get(id)?.blockType==="condition"),hasExit=component.some(id=>byId.get(id)?.blockType==="condition"&&(outgoing.get(id)??[]).some(edge=>!ids.has(edge.target)));if(!hasCondition)context.addIssue({code:"custom",message:"Every cycle must contain a Condition.",path:["edges"]});if(!hasExit)context.addIssue({code:"custom",message:"Every cyclic region must have a structural exit.",path:["edges"]});}
}

export const workflowDefinitionV2Schema=z.object({schemaVersion:z.literal(2),id,name:z.string().trim().min(1).max(120),description:z.string().max(2000),status:z.literal("draft"),exposableAsBlock:z.boolean().optional(),nodes:z.array(workflowNodeSchema).min(1).max(MAX_WORKFLOW_STEPS),edges:z.array(workflowEdgeSchema).max(MAX_STEP_EXECUTIONS),limits:z.object({maxStepExecutions:z.number().int().min(1).max(MAX_STEP_EXECUTIONS)}).strict()}).strict().superRefine((workflow,context)=>{const nodeIds=new Set<string>(),edgeIds=new Set<string>();workflow.nodes.forEach((node,index)=>{if(nodeIds.has(node.id))context.addIssue({code:"custom",message:"Node IDs must be unique.",path:["nodes",index,"id"]});nodeIds.add(node.id);try{workflowBlockRegistry.validate(node.blockType,node.blockVersion,node.config)}catch(error){context.addIssue({code:"custom",message:error instanceof Error?error.message:"Invalid block configuration.",path:["nodes",index,"config"]})}});workflow.edges.forEach((edge,index)=>{if(edgeIds.has(edge.id))context.addIssue({code:"custom",message:"Edge IDs must be unique.",path:["edges",index,"id"]});edgeIds.add(edge.id)});validateGraphTopology(workflow,context)});
export const workflowDefinitionSchema=workflowDefinitionV2Schema;

export type AgentPrompt=z.infer<typeof agentV2Schema>["prompt"];
export type AgentDefinitionV1 = z.infer<typeof agentDefinitionSchema>;
export type WorkflowDefinitionV1 = z.infer<typeof historicalWorkflowDefinitionV1Schema>;
export type WorkflowDefinitionV2 = z.infer<typeof workflowDefinitionV2Schema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
const revision=z.string().min(1).max(100);
const invocationSegmentSchema=z.object({workflowId:id,workflowName:z.string().trim().min(1).max(120),invocationNodeId:id}).strict();
const compositeNodeProvenanceSchema=z.object({executionNodeId:id,rootNodeId:id,workflowId:id,workflowName:z.string().trim().min(1).max(120),semanticNodeId:id,invocationPath:z.array(invocationSegmentSchema).max(8),displayPath:z.string().min(1).max(2000)}).strict();
const compositeDependencySchema=z.object({workflowId:id,revision,definition:workflowDefinitionV2Schema,dependencyWorkflowIds:z.array(id).max(MAX_WORKFLOW_STEPS)}).strict();
export const workflowCompositionSnapshotSchema=z.object({snapshotVersion:z.literal(1),dependencies:z.array(compositeDependencySchema).max(MAX_WORKFLOW_STEPS),nodes:z.array(compositeNodeProvenanceSchema).min(1).max(MAX_WORKFLOW_STEPS)}).strict().superRefine((value,context)=>{if(new Set(value.dependencies.map(item=>item.workflowId)).size!==value.dependencies.length)context.addIssue({code:"custom",message:"Composite dependency IDs must be unique.",path:["dependencies"]});if(new Set(value.nodes.map(item=>item.executionNodeId)).size!==value.nodes.length)context.addIssue({code:"custom",message:"Composite execution node IDs must be unique.",path:["nodes"]});});
export type WorkflowCompositionSnapshot=z.infer<typeof workflowCompositionSnapshotSchema>;
export type VersionedWorkflowDefinition={definition:WorkflowDefinition;fileSha:string};
export const historicalWorkflowV2ExecutionPlanSchema=z.object({nodes:z.array(z.object({id,agentId:id}).strict()).min(1).max(MAX_WORKFLOW_STEPS),edges:z.array(z.object({source:id,target:id}).strict()).max(MAX_WORKFLOW_STEPS-1),entryNodeId:id,terminalNodeId:id,maxStepExecutions:z.number().int().min(1).max(MAX_STEP_EXECUTIONS)}).strict();
const genericPlanNode=z.discriminatedUnion("blockType",[
 z.object({id,blockType:z.literal("agent"),blockVersion:z.literal(1),config:z.object({agentId:id}).strict()}).strict(),
 z.object({id,blockType:z.literal("condition"),blockVersion:z.literal(1),config:z.object({operator:z.literal("contains"),value:z.string().min(1).max(4096),caseSensitive:z.boolean()}).strict()}).strict(),
 z.object({id,blockType:z.literal("join"),blockVersion:z.literal(1),config:z.object({}).strict()}).strict(),
 z.object({id,blockType:z.literal("approval"),blockVersion:z.literal(1),config:z.object({message:z.string().trim().min(1).max(2000)}).strict()}).strict(),
]);
export const genericWorkflowExecutionPlanSchema=z.object({planVersion:z.literal(2),nodes:z.array(genericPlanNode).min(1).max(MAX_WORKFLOW_STEPS),edges:z.array(z.object({source:id,sourcePort:id,target:id,targetPort:id}).strict()).max(MAX_STEP_EXECUTIONS),entryNodeId:id,terminalNodeId:id,maxStepExecutions:z.number().int().min(1).max(MAX_STEP_EXECUTIONS)}).strict();
export const workflowV2ExecutionPlanSchema=z.union([historicalWorkflowV2ExecutionPlanSchema,genericWorkflowExecutionPlanSchema]);
export type HistoricalWorkflowV2ExecutionPlan=z.infer<typeof historicalWorkflowV2ExecutionPlanSchema>;
export type GenericWorkflowExecutionPlan=z.infer<typeof genericWorkflowExecutionPlanSchema>;
export type WorkflowV2ExecutionPlan=z.infer<typeof workflowV2ExecutionPlanSchema>;

export function validateAgentAdapterOptions(agent:AgentDefinitionV1,adapter:string){return {...agent,adapterOptions:validateAdapterOptions(adapter,agent.adapterOptions)};}
export function validateAgentForConnection(agent:AgentDefinitionV1,connection:{adapter:string;defaultModel?:string}){const definition=validateAgentAdapterOptions(agent,connection.adapter);if(definition.tools?.length&&connection.adapter!=="openai-agents")throw new Error("agent_tool_runtime_unsupported");if(connection.adapter==="openai-responses"||connection.adapter==="openai-agents")validateOpenAIModelAgentOptions(connection.defaultModel,definition.adapterOptions as import("./workflow-adapter.ts").OpenAIResponsesOptions);return definition;}

/** Validates and returns the only representation permitted in current Agent Git files. */
export function persistedAgentDefinition(agent:AgentDefinitionV1):PersistedAgentDefinition {const persisted:Record<string,unknown>={...agent};delete persisted.masterPrompt;return persistedAgentDefinitionSchema.parse(persisted);}

export const agentDefinitionPath = (idValue: string, root = "agents") => `${root.replace(/^\/+|\/+$/g, "")}/${id.parse(idValue)}.agent.json`;
export const workflowDefinitionPath = (idValue: string, root = "workflows") => `${root.replace(/^\/+|\/+$/g, "")}/${id.parse(idValue)}.workflow.json`;

/** Canonical UTF-8 representation used in Git and immutable run snapshots. */
export function canonicalJson(value: unknown) {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : item;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export function workflowAgentReferences(workflow:WorkflowDefinition){return workflow.nodes.flatMap(node=>workflowBlockRegistry.references(node.blockType,node.blockVersion,node.config).agentIds??[]);}
export function workflowSubworkflowReferences(workflow:WorkflowDefinition){return workflow.nodes.flatMap(node=>workflowBlockRegistry.references(node.blockType,node.blockVersion,node.config).workflowIds??[]);}

const MAX_COMPOSITE_DEPTH=8;
const pathKey=(segments:readonly string[])=>segments.map(value=>`${new TextEncoder().encode(value).length}:${value}`).join("|");
const stableDigest=(value:string)=>{const bytes=new TextEncoder().encode(value),seeds=[2166136261,2246822507,3266489909,668265263];return seeds.map(seed=>{let hash=seed;for(const byte of bytes)hash=Math.imul(hash^byte,16777619);return(hash>>>0).toString(16).padStart(8,"0")}).join("")};
const scopedId=(kind:"n"|"e",segments:readonly string[])=>`sw${kind}-${stableDigest(pathKey(segments))}`;
export type ComposedWorkflowV2={workflow:WorkflowDefinitionV2;composition:WorkflowCompositionSnapshot};
/** Deterministically replaces compact subworkflow nodes with frozen primitive child graphs and immutable provenance. */
export function composeVersionedWorkflowV2(root:VersionedWorkflowDefinition,versions:readonly VersionedWorkflowDefinition[]):ComposedWorkflowV2{
 if(root.definition.schemaVersion!==2)throw new Error("subworkflow_root_not_v2");const rootWorkflow=root.definition,available=new Map(versions.map(value=>[value.definition.id,value])),used=new Map<string,z.infer<typeof compositeDependencySchema>>(),provenance:WorkflowCompositionSnapshot["nodes"]=[],claimed=new Map<string,string>();
 const claim=(kind:"n"|"e",generated:string,key:string)=>{const identity=`${kind}:${generated}`,previous=claimed.get(identity);if(previous&&previous!==key)throw new Error("subworkflow_identity_collision");claimed.set(identity,key);return generated};
 const expand=(workflow:WorkflowDefinitionV2,path:Array<{workflowId:string;workflowName:string;invocationNodeId:string}>,stack:string[]):WorkflowDefinitionV2=>{if(stack.length>MAX_COMPOSITE_DEPTH)throw new Error("subworkflow_depth_exceeded");const replacements=new Map<string,{entry:string;terminal:string}>(),nodes:WorkflowDefinitionV2["nodes"]=[],edges:WorkflowDefinitionV2["edges"]=[];
  for(const node of workflow.nodes){const refs=workflowBlockRegistry.references(node.blockType,node.blockVersion,node.config).workflowIds??[];if(!refs.length){const key=pathKey([...path.flatMap(item=>[item.workflowId,item.invocationNodeId]),workflow.id,node.id]),executionNodeId=path.length?claim("n",scopedId("n",[key]),key):claim("n",node.id,key);nodes.push({...node,id:executionNodeId});const rootNodeId=path[0]?.invocationNodeId??node.id,labels=[rootWorkflow.name,...path.map(item=>item.workflowName),node.blockType==="agent"?node.id:workflowBlockRegistry.resolve(node.blockType,node.blockVersion).ui.label];provenance.push({executionNodeId,rootNodeId,workflowId:workflow.id,workflowName:workflow.name,semanticNodeId:node.id,invocationPath:path,displayPath:labels.join(" / ")});continue}const childId=refs[0];if(stack.includes(childId))throw new Error(`subworkflow_cycle:${[...stack,childId].join("->")}`);const versioned=available.get(childId);if(!versioned)throw new Error(`missing_subworkflow:${childId}`);if(versioned.definition.schemaVersion!==2)throw new Error(`subworkflow_not_v2:${childId}`);const child=versioned.definition;if(!child.exposableAsBlock)throw new Error(`subworkflow_not_exposed:${childId}`);used.set(childId,{workflowId:childId,revision:versioned.fileSha,definition:child,dependencyWorkflowIds:workflowSubworkflowReferences(child)});const expanded=expand(child,[...path,{workflowId:child.id,workflowName:child.name,invocationNodeId:node.id}],[...stack,childId]);const entry=graphEntryNode(expanded.nodes,expanded.edges),outgoing=new Set(expanded.edges.map(edge=>edge.source)),terminal=expanded.nodes.find(value=>!outgoing.has(value.id))!.id;replacements.set(node.id,{entry,terminal});nodes.push(...expanded.nodes);edges.push(...expanded.edges)}
  for(const edge of workflow.edges){const source=replacements.get(edge.source)?.terminal??(path.length?provenance.find(item=>item.workflowId===workflow.id&&item.semanticNodeId===edge.source&&JSON.stringify(item.invocationPath)===JSON.stringify(path))!.executionNodeId:edge.source),target=replacements.get(edge.target)?.entry??(path.length?provenance.find(item=>item.workflowId===workflow.id&&item.semanticNodeId===edge.target&&JSON.stringify(item.invocationPath)===JSON.stringify(path))!.executionNodeId:edge.target),key=pathKey([...path.flatMap(item=>[item.workflowId,item.invocationNodeId]),workflow.id,edge.id]),edgeId=path.length?claim("e",scopedId("e",[key]),key):claim("e",edge.id,key);edges.push({...edge,id:edgeId,source,target})}return{...workflow,id:rootWorkflow.id,exposableAsBlock:rootWorkflow.exposableAsBlock,nodes,edges,limits:rootWorkflow.limits}};
 const workflow=expand(rootWorkflow,[],[rootWorkflow.id]);if(workflow.nodes.length>MAX_WORKFLOW_STEPS||workflow.edges.length>MAX_STEP_EXECUTIONS)throw new Error("subworkflow_expansion_too_large");const outgoing=new Set(workflow.edges.map(edge=>edge.source)),terminal=workflow.nodes.find(node=>!outgoing.has(node.id));if(!terminal||terminal.blockType!=="agent"||workflow.nodes.some(node=>node.blockType==="subworkflow"))throw new Error("unsupported_workflow_topology:invalid_composite_terminal");return{workflow:workflowDefinitionV2Schema.parse(workflow),composition:workflowCompositionSnapshotSchema.parse({snapshotVersion:1,dependencies:[...used.values()].sort((a,b)=>a.workflowId.localeCompare(b.workflowId)),nodes:provenance})};
}
export function composeWorkflowV2(root:WorkflowDefinitionV2,dependencies:ReadonlyMap<string,WorkflowDefinitionV2>):WorkflowDefinitionV2{return composeVersionedWorkflowV2({definition:root,fileSha:"root"},[{definition:root,fileSha:"root"},...[...dependencies.values()].map(definition=>({definition,fileSha:`revision-${definition.id}`}))]).workflow}
export function validateAndComposeWorkflow(workflow:WorkflowDefinition,definitions:readonly WorkflowDefinition[]){return composeVersionedWorkflowV2({definition:workflow,fileSha:"validation"},definitions.map(definition=>({definition,fileSha:`validation-${definition.id}`}))).workflow}

/** Fails closed when changing a reusable Workflow would invalidate a saved transitive dependent. */
export function assertReusableWorkflowUpdateCompatible(current:WorkflowDefinition,proposed:WorkflowDefinition,definitions:readonly WorkflowDefinition[]){
 const candidates=definitions.map(definition=>definition.id===current.id?proposed:definition),affected=new Set([current.id]);
 for(let changed=true;changed;){changed=false;for(const definition of candidates){if(affected.has(definition.id)||!workflowSubworkflowReferences(definition).some(id=>affected.has(id)))continue;affected.add(definition.id);changed=true}}
 for(const definition of candidates){if(definition.id===current.id||!affected.has(definition.id)||definition.schemaVersion!==2)continue;try{validateAndComposeWorkflow(definition,candidates)}catch{throw new Error("workflow_dependency_incompatible")}}
}

function graphEntryNode(nodes:WorkflowDefinitionV2["nodes"],edges:WorkflowDefinitionV2["edges"]){const incoming=new Map(nodes.map(node=>[node.id,0]));for(const edge of edges)incoming.set(edge.target,incoming.get(edge.target)!+1);const roots=[...incoming].filter(([,count])=>count===0).map(([id])=>id);if(roots.length===1)return roots[0];const byId=new Map(nodes.map(node=>[node.id,node])),outgoing=new Map(nodes.map(node=>[node.id,[] as string[]]));for(const edge of edges)outgoing.get(edge.source)!.push(edge.target);const candidates=edges.filter(edge=>byId.get(edge.source)?.blockType==="condition"&&(()=>{const seen=new Set<string>();const visit=(id:string):boolean=>id===edge.source?true:seen.has(id)?false:(seen.add(id),outgoing.get(id)!.some(visit));return visit(edge.target)})()).map(edge=>edge.target);if(new Set(candidates).size!==1)throw new Error("unsupported_workflow_topology:ambiguous_entry");return candidates[0]}

/** Immutable ADT-owned graph plan. Config and semantic ports are resolved at launch. */
export function compileWorkflowV2ExecutionPlan(workflow:WorkflowDefinitionV2,agents:readonly AgentDefinitionV1[]):GenericWorkflowExecutionPlan{
 const parsed=workflowDefinitionV2Schema.parse(workflow),agentIds=new Set(agents.map(agent=>agent.id)),byId=new Map(parsed.nodes.map(node=>[node.id,node])),incoming=new Map(parsed.nodes.map(node=>[node.id,0])),outgoing=new Map(parsed.nodes.map(node=>[node.id,0]));for(const edge of parsed.edges){incoming.set(edge.target,incoming.get(edge.target)!+1);outgoing.set(edge.source,outgoing.get(edge.source)!+1)}for(const node of parsed.nodes)for(const agentId of workflowBlockRegistry.references(node.blockType,node.blockVersion,node.config).agentIds??[])if(!agentIds.has(agentId))throw new Error(`missing_agent:${agentId}`);return genericWorkflowExecutionPlanSchema.parse({planVersion:2,nodes:parsed.nodes.map(node=>({id:node.id,blockType:node.blockType,blockVersion:node.blockVersion,config:structuredClone(workflowBlockRegistry.validate(node.blockType,node.blockVersion,node.config))})),edges:parsed.edges.map(edge=>{const source=byId.get(edge.source)!,target=byId.get(edge.target)!;return{source:edge.source,sourcePort:workflowBlockRegistry.port(source.blockType,source.blockVersion,"outputs",edge.sourcePort),target:edge.target,targetPort:workflowBlockRegistry.port(target.blockType,target.blockVersion,"inputs",edge.targetPort)}}),entryNodeId:graphEntryNode(parsed.nodes,parsed.edges),terminalNodeId:[...outgoing].find(([,count])=>count===0)![0],maxStepExecutions:parsed.limits.maxStepExecutions});
}


export async function validateWorkflowReferences(workflow: WorkflowDefinition, agents: readonly AgentDefinitionV1[], availableConnections: ReadonlySet<string>) {
  compileWorkflowV2ExecutionPlan(workflow,agents);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  for (const agentId of workflowAgentReferences(workflow)) {
    const agent = byId.get(agentId);
    if (!agent) throw new Error(`missing_agent:${agentId}`);
    if (!availableConnections.has(agent.connectionKey)) throw new Error(`connection_unavailable:${agent.connectionKey}`);
  }
}

export function validateTerminalCodexSteps(workflow:WorkflowDefinitionV1,agents:readonly AgentDefinitionV1[],adapterForConnection:(key:string)=>string|undefined){const byId=new Map(agents.map(agent=>[agent.id,agent]));workflow.steps.forEach((step,index)=>{const agent=byId.get(step.agentId);if(agent&&adapterForConnection(agent.connectionKey)==="codex-cloud"&&index!==workflow.steps.length-1)throw new Error("codex_cloud_terminal_only");});}
