import {z} from "zod";
import {failureCategories} from "./workflow-adapter.ts";
import {runtimeSafeErrorCodes} from "./workflow-orchestration-diagnostics.ts";

export const agentOperationDiagnosticsSchema=z.object({
  operation:z.enum(["model_progression","tool_execution","security_decision"]),
  stage:z.enum(["preparation","readiness","dispatch","response"]),
  clientRequestId:z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  outcome:z.enum(["not_dispatched","response_received","timeout","network_error"]),
  reason:z.enum(["cross_request_io","platform_subrequest_limit","invalid_request_context","network_connection_lost","aborted","fetch_type_error","unknown"]).optional(),
  runtimeErrorName:z.enum(["TypeError","AbortError","Error"]).optional(),
  runtimeCode:z.enum([...runtimeSafeErrorCodes,"wrapping_key_invalid","unexpected_redirect"]).optional(),
  elapsedMs:z.number().int().min(0).max(3_600_000),
  httpStatus:z.number().int().min(100).max(599).optional(),
  providerExecutionEntered:z.boolean().optional(),
}).strict();
export type AgentOperationDiagnostics=z.infer<typeof agentOperationDiagnosticsSchema>;

export const journaledAgentFailureSchema=z.object({
  category:z.enum(failureCategories),
  safeMessage:z.string().min(1).max(512),
  diagnostics:agentOperationDiagnosticsSchema.optional(),
}).strict();
export type JournaledAgentFailure=z.infer<typeof journaledAgentFailureSchema>;

export function parseJournaledAgentFailure(value:unknown):JournaledAgentFailure|undefined{
  if(typeof value!=="string"||value.length>4096)return;
  try{return journaledAgentFailureSchema.safeParse(JSON.parse(value)).data}catch{return undefined}
}
