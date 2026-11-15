import {z} from "zod";

export const ADT_DATA_TOOLS = ["adt_workflows_list", "adt_workflow_read", "adt_executions_list", "adt_execution_read", "adt_execution_metrics"] as const;
export type AdtDataTool = typeof ADT_DATA_TOOLS[number];
export const isAdtDataTool = (name:string):name is AdtDataTool => (ADT_DATA_TOOLS as readonly string[]).includes(name);
export const ADT_DATA_TOOL_DESCRIPTIONS:Record<AdtDataTool,string> = {
  adt_workflows_list:"List authorised ADT workflows and revision metadata. Bounded pages; no prompts or starter inputs.",
  adt_workflow_read:"Read a workflow graph and safe Agent settings. Prompts, condition text and credentials are excluded.",
  adt_executions_list:"List repository-scoped ADT execution metadata, filtered by workflow, status and creation time. No execution content.",
  adt_execution_read:"Read execution progression, failure categories and persisted sanitised orchestration diagnostics. Inputs, outputs and raw errors are unavailable.",
  adt_execution_metrics:"Aggregate recorded execution statuses, duration and retry counts in a bounded sample. Provider-reported journal token usage is partial; cost is unavailable.",
};
const id=z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
export const executionStatus=z.enum(["queued","running","waiting_approval","cancelling","succeeded","failed","cancelled"]);
const pagination={offset:z.number().int().min(0).max(10000).optional(),limit:z.number().int().min(1).max(20).optional()};
const filters={workflowId:id.optional(),status:executionStatus.optional(),createdAfter:z.string().datetime().optional(),createdBefore:z.string().datetime().optional()};
export const adtDataArgumentSchemas={
  adt_workflows_list:z.object({...pagination,query:z.string().max(120).optional()}).strict(),
  adt_workflow_read:z.object({workflowId:id}).strict(),
  adt_executions_list:z.object({...pagination,...filters}).strict(),
  adt_execution_read:z.object({runId:z.string().uuid(),...pagination}).strict(),
  adt_execution_metrics:z.object(filters).strict(),
};

// Model-visible schemas use the existing bounded journal validator's supported subset.
// Identifier/date syntax is validated again by the exact server-side Zod schemas above.
const identifier={type:"string",minLength:1,maxLength:80},date={type:"string",minLength:1,maxLength:40};
const pageProperties={offset:{type:"integer",minimum:0,maximum:10000},limit:{type:"integer",minimum:1,maximum:20}};
const filterProperties={workflowId:identifier,status:{type:"string",enum:executionStatus.options},createdAfter:date,createdBefore:date};
const object=(properties:Record<string,unknown>,required:string[]=[])=>({type:"object",properties,required,additionalProperties:false});
export const adtDataModelSchemas:Record<AdtDataTool,Record<string,unknown>>={
  adt_workflows_list:object({...pageProperties,query:{type:"string",maxLength:120}}),
  adt_workflow_read:object({workflowId:identifier},["workflowId"]),
  adt_executions_list:object({...pageProperties,...filterProperties}),
  adt_execution_read:object({runId:{type:"string",minLength:1,maxLength:36},...pageProperties},["runId"]),
  adt_execution_metrics:object(filterProperties),
};
