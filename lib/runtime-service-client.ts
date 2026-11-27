import { z } from "zod";
import {
  managementDependenciesSchema, managementEvidenceSchema, runtimeControlErrorCodeSchema,
  RUNTIME_CONTROL_PATH, RUNTIME_CONTROL_BYTES, RUNTIME_MANAGEMENT_DIAGNOSTIC_SCHEMA,
  RUNTIME_MANAGEMENT_DIAGNOSTIC_TIMEOUT_MS, RUNTIME_REPOSITORY_BROKER_PATH,
  type ManagementDependencies, type ManagementObservation, type RepositoryBrokerRequest,
  type RuntimeControlCommand, type RuntimeManagementDiagnostic,
} from "../adt-runtime/src/runtime-control-contract.ts";
import { ADT_RUNTIME_PROTOCOL, signedHeaders, boundedJson, runtimeRequestId,
  runtimeServiceTarget, type ADTRuntimeConfiguration } from "./adt-runtime-client.ts";

const encoder = new TextEncoder();
export const WORKFLOW_OVERVIEW_HISTORY_LIMIT = 10;
export const WORKFLOW_HISTORY_LIMIT = 50;

function post(target: URL, headers: Record<string, string>, body: string, timeoutMs: number) {
  return fetch(target, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
}

const wireSchema = z.object({
  protocolVersion: z.string().regex(/^adt-runtime-v\d{1,3}$/),
  ok: z.boolean(),
  result: z.unknown().optional(),
  code: z.unknown().optional(),
  error: z.object({ code: z.unknown() }).optional(),
  management: managementEvidenceSchema.optional(),
});
const namedWorkflow = z.object({ name: z.string() });
const historySchema = z.array(z.object({
  id: z.string().min(1),
  workflowId: z.string().min(1),
  status: z.enum(["queued", "running", "waiting_approval", "cancelling", "succeeded", "failed", "cancelled"]),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  currentStepId: z.string().optional(),
  workflowSnapshot: namedWorkflow.optional(),
  semanticWorkflowSnapshot: namedWorkflow.optional(),
}));

const runtimeServiceErrorCodes = {
  not_configured: "runtime_not_configured",
  unreachable: "runtime_transport_unavailable",
  malformed_response: "runtime_response_invalid",
  authentication_failed: "runtime_authentication_failed",
  protocol_incompatible: "protocol_incompatible",
  request_rejected: "runtime_request_rejected",
  management_unavailable: "runtime_unavailable",
  nonce_persistence_unavailable: "nonce_persistence_unavailable",
  storage_query_unavailable: "storage_query_unavailable",
  storage_data_invalid: "storage_data_invalid",
} as const;
type RuntimeServiceErrorCode = typeof runtimeServiceErrorCodes[keyof typeof runtimeServiceErrorCodes];
type RuntimeManagementErrorCode = RuntimeServiceErrorCode | z.infer<typeof runtimeControlErrorCodeSchema> | "body_too_large";
const serviceFailures = new Set<RuntimeManagementErrorCode>(Object.values(runtimeServiceErrorCodes));

export class RuntimeManagementError extends Error {
  readonly code: RuntimeManagementErrorCode;
  readonly observation: ManagementObservation;
  constructor(code: RuntimeManagementErrorCode, observation: ManagementObservation) {
    super(code);
    this.code = code;
    this.observation = observation;
  }
}

export function isRuntimeServiceFailure(error: unknown): error is RuntimeManagementError & { code: RuntimeServiceErrorCode } {
  return error instanceof RuntimeManagementError && serviceFailures.has(error.code);
}

async function requestRuntimeControl<T>(config: ADTRuntimeConfiguration, input: RuntimeControlCommand, timeoutMs?: number) {
  const started = Date.now();
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const requestId = await runtimeRequestId(nonce);
  const received: { httpStatus?: number; evidence?: z.infer<typeof managementEvidenceSchema> } = {};
  const observe = (stage: ManagementObservation["stage"], result: ManagementObservation["result"]): ManagementObservation => {
    const observation = {
      authenticated: null, protocolCompatible: null, noncePersisted: null, accepted: null, dispatched: null,
      ...received.evidence, requestId, stage, result, httpStatus: received.httpStatus, elapsedMs: Date.now() - started,
    };
    console.info(JSON.stringify({ event: "worker_runtime_management_request", operation: input.operation, ...observation }));
    return observation;
  };
  const fail = (stage: ManagementObservation["stage"], result: ManagementObservation["result"], code?: RuntimeManagementErrorCode): never => {
    const fallback = runtimeServiceErrorCodes[result as keyof typeof runtimeServiceErrorCodes] ?? "runtime_unavailable";
    throw new RuntimeManagementError(code ?? fallback, observe(stage, result));
  };

  const target = runtimeServiceTarget(config.baseUrl, config.authSecret, RUNTIME_CONTROL_PATH);
  if (!target) return fail("configuration", "not_configured", "runtime_not_configured");
  const body = JSON.stringify(input);
  if (encoder.encode(body).byteLength > RUNTIME_CONTROL_BYTES) return fail("validation", "request_rejected", "body_too_large");
  const headers = await signedHeaders(config.authSecret!, "POST", RUNTIME_CONTROL_PATH, body, nonce);
  const diagnostic = input.operation === "runs.diagnose";
  let response: Response;
  try {
    response = await post(target, headers, body, timeoutMs ?? (input.operation === "provider" ? 120_000 : 30_000));
  } catch {
    return fail("transport", "unreachable");
  }
  received.httpStatus = response.status;
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    return fail("response", "request_rejected");
  }
  let value: unknown;
  try { value = await boundedJson(response, diagnostic ? 8_192 : RUNTIME_CONTROL_BYTES); }
  catch { return fail("response", "malformed_response"); }
  const parsed = wireSchema.safeParse(value);
  if (!parsed.success || (parsed.data.management && parsed.data.management.requestId !== requestId)) {
    return fail("response", "malformed_response");
  }
  const wire = parsed.data;
  if (wire.protocolVersion !== ADT_RUNTIME_PROTOCOL) return fail("protocol", "protocol_incompatible");
  const evidence = received.evidence = wire.management;
  if (response.ok && wire.ok === true && wire.result !== undefined) {
    if (evidence && evidence.result !== "ok") return fail("response", "malformed_response");
    if (diagnostic) {
      const dependencies = managementDependenciesSchema.safeParse(wire.result);
      if (!dependencies.success || evidence?.result !== "ok" || !evidence.authenticated ||
        !evidence.protocolCompatible || !evidence.noncePersisted || !evidence.accepted || !evidence.dispatched)
        return fail("response", "malformed_response");
      return { result: dependencies.data as T, observation: observe("complete", "ok") };
    }
    if (input.operation === "runs.list" && !historySchema.max(input.limit).safeParse(wire.result).success)
      return fail("response", "malformed_response");
    return { result: wire.result as T, observation: observe("complete", "ok") };
  }
  if (response.ok || wire.ok !== false) return fail("response", "malformed_response");
  const code = runtimeControlErrorCodeSchema.safeParse(wire.code ?? wire.error?.code).data;
  if (!code) return fail("response", "malformed_response");
  if (code === "invalid_request" && (input.operation.startsWith("conversations.") || input.operation === "runs.action" ||
      input.operation === "knowledge.from-action" || input.operation === "runs.launch" && input.conversation)) {
    return fail("validation", "request_rejected", "conversation_runtime_unavailable");
  }
  if (evidence) {
    if (evidence.result === "ok") return fail("response", "malformed_response");
    return fail(evidence.stage, evidence.result, code === "runtime_unavailable" ? undefined : code);
  }
  // Release 16 and earlier can return either error envelope. The HTTP status
  // and allowlisted code are observable. Nonce persistence and dispatch are unknown.
  if (input.operation === "runs.list" && code === "invalid_run_snapshot") return fail("storage", "storage_data_invalid");
  switch (code) {
    case "runtime_authentication_failed": return fail("authentication", "authentication_failed");
    case "protocol_incompatible": return fail("protocol", "protocol_incompatible");
    case "invalid_request": return fail("validation", "request_rejected", code);
    case "runtime_unavailable": return fail("management", "management_unavailable");
    default: return fail("dispatch", "operation_rejected", code);
  }
}

export async function runtimeControl<T>(config: ADTRuntimeConfiguration, input: RuntimeControlCommand): Promise<T> {
  return (await requestRuntimeControl<T>(config, input)).result;
}

export async function diagnoseRuntimeManagement(
  config: ADTRuntimeConfiguration,
  scope: Extract<RuntimeControlCommand, { operation: "runs.diagnose" }>["scope"],
): Promise<RuntimeManagementDiagnostic> {
  const { repositoryId } = scope;
  const unknown = { status: "not_verified" as const };
  const [probe, workflowHistory] = await Promise.all([
    requestRuntimeControl<ManagementDependencies>(config, { operation: "runs.diagnose", repositoryId, scope },
      RUNTIME_MANAGEMENT_DIAGNOSTIC_TIMEOUT_MS).catch(error => {
      if (!(error instanceof RuntimeManagementError)) throw error;
      return { observation: error.observation, result: { postgres: unknown, checkpoints: unknown, workflow: unknown, broker: unknown } };
    }),
    // Use the same limit and response validation as the full Workflow history page.
    // Only the observation survives this read. No run data enters the report.
    requestRuntimeControl(config, { operation: "runs.list", repositoryId, limit: WORKFLOW_HISTORY_LIMIT },
      RUNTIME_MANAGEMENT_DIAGNOSTIC_TIMEOUT_MS).then(({ observation }) => observation, error => {
      if (!(error instanceof RuntimeManagementError)) throw error;
      return error.observation;
    }),
  ]);
  const { result, elapsedMs, dispatched } = workflowHistory;
  const storageFailure = result === "storage_query_unavailable" || result === "storage_data_invalid" ? result : undefined;
  const status = result === "ok" ? "available"
    : storageFailure || dispatched || probe.observation.result === "ok" ? "unavailable" : "not_verified";
  return {
    schema: RUNTIME_MANAGEMENT_DIAGNOSTIC_SCHEMA,
    management: probe.observation,
    workflowHistory,
    dependencies: { ...probe.result, workflow: { status, elapsedMs, ...(storageFailure ? { result: storageFailure } : {}) } },
  };
}

const credentialSchema = z.object({
  token: z.string().min(1).max(4_096), expiresAt: z.string(),
  permissions: z.object({ contents: z.enum(["read", "write"]).optional(), pull_requests: z.enum(["read", "write"]).optional() }).passthrough(),
});
export async function requestRepositoryCredential(config: { base?: string; authSecret?: string }, input: RepositoryBrokerRequest, timeoutMs = 30_000) {
  try {
    const target = runtimeServiceTarget(config.base, config.authSecret, RUNTIME_REPOSITORY_BROKER_PATH);
    if (!target) throw new Error("runtime_not_configured");
    const body = JSON.stringify(input);
    if (encoder.encode(body).byteLength > 8192) throw new Error("body_too_large");
    const headers = await signedHeaders(config.authSecret!, "POST", RUNTIME_REPOSITORY_BROKER_PATH, body, crypto.randomUUID().replaceAll("-", ""));
    const response = await post(target, headers, body, timeoutMs);
    const wire = wireSchema.parse(await boundedJson(response, 8192));
    if (wire.protocolVersion !== ADT_RUNTIME_PROTOCOL) throw new Error("protocol_incompatible");
    if (!response.ok || !wire.ok) {
      if (wire.ok === false && wire.code === "permission_denied") throw new Error("permission_denied");
      throw new Error("github_broker_unavailable");
    }
    return credentialSchema.parse(wire.result);
  } catch (error) {
    if (error instanceof Error && error.message === "permission_denied") throw error;
    throw new Error("github_broker_unavailable");
  }
}
