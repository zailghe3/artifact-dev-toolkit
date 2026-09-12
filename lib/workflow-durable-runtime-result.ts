import type { LangGraphAdvanceResult, RemoteRuntimeFailure } from "./adt-runtime-client.ts";
import { failureCategories, type FailureCategory, type ProviderTransportDiagnostics } from "./workflow-adapter.ts";
import {
  parseRuntimeOrchestrationEvidence,
  runtimeSafeErrorCodes,
  type RuntimeOrchestrationEvidence,
  type RuntimeSafeErrorCode,
} from "./workflow-orchestration-diagnostics.ts";

const encoder = new TextEncoder();
const MAX_DURABLE_RUNTIME_FAILURE_BYTES = 4096;
const MAX_SAFE_MESSAGE_BYTES = 512;
const categories = new Set<string>(failureCategories);
const runtimeCodes = new Set<string>(runtimeSafeErrorCodes);
const outcomes = new Set(["response_received", "timeout", "network_error"]);
const reasons = new Set(["cross_request_io", "platform_subrequest_limit", "invalid_request_context", "network_connection_lost", "aborted", "fetch_type_error", "unknown"]);
const errorNames = new Set(["AbortError", "TypeError", "Error"]);

export type DurableRuntimeFailure = {
  category: FailureCategory;
  safeMessage: string;
  runtimeCode?: RuntimeSafeErrorCode;
  transportDiagnostics?: ProviderTransportDiagnostics;
  orchestration?: RuntimeOrchestrationEvidence;
};
export type DurableRuntimeRequestCounts={readiness:number;langgraphExecution:number};

export type DurableLangGraphStepResult =
  | { kind: "result"; result: LangGraphAdvanceResult; requestCounts:DurableRuntimeRequestCounts }
  | { kind: "runtime_failure"; failure: DurableRuntimeFailure; requestCounts:DurableRuntimeRequestCounts };
export type DurableRuntimeValidationResult={kind:"validated";requestCounts:DurableRuntimeRequestCounts}|{kind:"runtime_failure";failure:DurableRuntimeFailure;requestCounts:DurableRuntimeRequestCounts};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
const identifier = (value: unknown, max = 256) => typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9:_-]+$/.test(value);

function parseTransport(value: unknown): ProviderTransportDiagnostics | undefined {
  const transport = record(value);
  if (!transport || !exact(transport, ["clientRequestId", "requestId", "httpStatus", "elapsedMs", "processingMs", "outcome", "reason", "runtimeErrorName"]) ||
    !identifier(transport.clientRequestId) || transport.requestId !== undefined && !identifier(transport.requestId) ||
    transport.httpStatus !== undefined && !integer(transport.httpStatus, 100, 599) || !integer(transport.elapsedMs, 0, 3_600_000) ||
    transport.processingMs !== undefined && !integer(transport.processingMs, 0, 3_600_000) || !outcomes.has(String(transport.outcome)) ||
    transport.reason !== undefined && !reasons.has(String(transport.reason)) || transport.runtimeErrorName !== undefined && !errorNames.has(String(transport.runtimeErrorName))) return;
  return transport as ProviderTransportDiagnostics;
}

function parseFailure(value: unknown): DurableRuntimeFailure | undefined {
  const failure = record(value);
  if (!failure || !exact(failure, ["category", "safeMessage", "runtimeCode", "transportDiagnostics", "orchestration"]) ||
    !categories.has(String(failure.category)) || typeof failure.safeMessage !== "string" || !failure.safeMessage || encoder.encode(failure.safeMessage).byteLength > MAX_SAFE_MESSAGE_BYTES ||
    failure.runtimeCode !== undefined && !runtimeCodes.has(String(failure.runtimeCode))) return;
  const transportDiagnostics = failure.transportDiagnostics === undefined ? undefined : parseTransport(failure.transportDiagnostics);
  const orchestration = failure.orchestration === undefined ? undefined : parseRuntimeOrchestrationEvidence(failure.orchestration);
  if (failure.transportDiagnostics !== undefined && !transportDiagnostics || failure.orchestration !== undefined && !orchestration) return;
  const parsed = {category: failure.category, safeMessage: failure.safeMessage, ...(failure.runtimeCode === undefined ? {} : {runtimeCode: failure.runtimeCode}), ...(transportDiagnostics ? {transportDiagnostics} : {}), ...(orchestration ? {orchestration} : {})} as DurableRuntimeFailure;
  return encoder.encode(JSON.stringify(parsed)).byteLength <= MAX_DURABLE_RUNTIME_FAILURE_BYTES ? parsed : undefined;
}

function parseResult(value: unknown): LangGraphAdvanceResult | undefined {
  const result = record(value);
  const states = new Set(["admission_required", "approval_required", "advanced", "completed", "pending", "failed", "cancelled", "execution_limit", "graph_failure"]);
  if (!result || !exact(result, ["state", "outputText", "frontier", "interruptId", "nodeId", "activationId", "message", "text", "safeMessage", "failureCode", "retryAfterMs"]) || !states.has(String(result.state))) return;
  for (const key of ["outputText", "interruptId", "nodeId", "activationId", "message", "text", "safeMessage"] as const) if (result[key] !== undefined && typeof result[key] !== "string") return;
  if (typeof result.outputText === "string" && encoder.encode(result.outputText).byteLength > 262_144 || typeof result.safeMessage === "string" && encoder.encode(result.safeMessage).byteLength > MAX_SAFE_MESSAGE_BYTES) return;
  if (result.frontier !== undefined && (!Array.isArray(result.frontier) || result.frontier.length > 3 || !result.frontier.every(item => {const entry=record(item);return Boolean(entry && exact(entry,["nodeId","activationId"]) && identifier(entry.nodeId) && identifier(entry.activationId));}))) return;
  if (result.failureCode !== undefined && !["output_too_large", "configuration_invalid"].includes(String(result.failureCode)) || result.retryAfterMs !== undefined && !integer(result.retryAfterMs, 1_000, 900_000)) return;
  return result as LangGraphAdvanceResult;
}

const parseCounts=(value:unknown):DurableRuntimeRequestCounts|undefined=>{const counts=record(value);return counts&&exact(counts,["readiness","langgraphExecution"])&&integer(counts.readiness,0,1)&&integer(counts.langgraphExecution,0,2)?counts as DurableRuntimeRequestCounts:undefined};
export function durableRuntimeFailure(error: RemoteRuntimeFailure,requestCounts:DurableRuntimeRequestCounts={readiness:0,langgraphExecution:0}): DurableLangGraphStepResult {
  const value = {kind: "runtime_failure", failure: {category: error.category, safeMessage: error.safeMessage, ...(error.runtimeCode ? {runtimeCode: error.runtimeCode} : {}), ...(error.transportDiagnostics ? {transportDiagnostics: error.transportDiagnostics} : {}), ...(error.orchestration ? {orchestration: error.orchestration} : {})},requestCounts};
  const parsed = parseDurableLangGraphStepResult(value);
  if (!parsed || parsed.kind !== "runtime_failure") throw new Error("invalid_runtime_failure");
  return parsed;
}

export function parseDurableLangGraphStepResult(value: unknown): DurableLangGraphStepResult | undefined {
  const envelope = record(value);
  if (!envelope || !exact(envelope, envelope.kind === "result" ? ["kind", "result","requestCounts"] : envelope.kind === "runtime_failure" ? ["kind", "failure","requestCounts"] : [])) return;
  const requestCounts=parseCounts(envelope.requestCounts);if(!requestCounts)return;
  if (envelope.kind === "result") { const result = parseResult(envelope.result); return result ? {kind: "result", result,requestCounts} : undefined; }
  if (envelope.kind === "runtime_failure") { const failure = parseFailure(envelope.failure); return failure ? {kind: "runtime_failure", failure,requestCounts} : undefined; }
}

export function parseDurableRuntimeValidationResult(value:unknown):DurableRuntimeValidationResult|undefined{const envelope=record(value);if(!envelope||!exact(envelope,envelope.kind==="validated"?["kind","requestCounts"]:envelope.kind==="runtime_failure"?["kind","failure","requestCounts"]:[]))return;const requestCounts=parseCounts(envelope.requestCounts);if(!requestCounts)return;if(envelope.kind==="validated")return{kind:"validated",requestCounts};const failure=parseFailure(envelope.failure);return failure?{kind:"runtime_failure",failure,requestCounts}:undefined}
