import { z } from "zod";
import {
  managementDependenciesSchema, managementEvidenceSchema, runtimeControlErrorCodeSchema,
  RUNTIME_CONTROL_PATH, RUNTIME_CONTROL_BYTES, RUNTIME_MANAGEMENT_DIAGNOSTIC_SCHEMA,
  RUNTIME_MANAGEMENT_DIAGNOSTIC_TIMEOUT_MS, RUNTIME_REPOSITORY_BROKER_PATH,
  type ManagementObservation, type RepositoryBrokerRequest, type RuntimeControlCommand, type RuntimeManagementDiagnostic,
} from "../adt-runtime/src/runtime-control-contract.ts";
import { ADT_RUNTIME_PROTOCOL, signedHeaders, boundedJson, type ADTRuntimeConfiguration } from "./adt-runtime-client.ts";

const encoder = new TextEncoder();

function serviceTarget(base: string | undefined, secret: string | undefined, path: string) {
  if (!base || !secret || secret.length < 32) return;
  try {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash) return;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return;
    // A reverse proxy may mount Runtime under a prefix. Sign the internal path
    // and send the request to the same external base URL as signed readiness.
    url.pathname = url.pathname.replace(/\/+$/, "") + path;
    return url;
  } catch { /* Invalid configuration. */ }
}

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

export class RuntimeManagementError extends Error {
  readonly observation: ManagementObservation;
  constructor(message: string, observation: ManagementObservation) {
    super(message);
    this.observation = observation;
  }
}

export async function runtimeControl<T>(config: ADTRuntimeConfiguration, input: RuntimeControlCommand): Promise<T> {
  const started = Date.now();
  const nonce = crypto.randomUUID().replaceAll("-", "");
  // The signed nonce binds the request. Its truncated hash is only a log correlation identifier.
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(nonce));
  const requestId = Buffer.from(digest).toString("base64url").slice(0, 32);
  const received: { httpStatus?: number; evidence?: z.infer<typeof managementEvidenceSchema> } = {};
  const observe = (stage: ManagementObservation["stage"], result: ManagementObservation["result"]): ManagementObservation => {
    const observation = {
      authenticated: null, protocolCompatible: null, noncePersisted: null, accepted: null, dispatched: null,
      ...received.evidence, requestId, stage, result, httpStatus: received.httpStatus, elapsedMs: Date.now() - started,
    };
    console.info(JSON.stringify({ event: "worker_runtime_management_request", operation: input.operation, ...observation }));
    return observation;
  };
  const fail = (stage: ManagementObservation["stage"], result: ManagementObservation["result"], code = "runtime_unavailable"): never => {
    throw new RuntimeManagementError(code, observe(stage, result));
  };

  const target = serviceTarget(config.baseUrl, config.authSecret, RUNTIME_CONTROL_PATH);
  if (!target) return fail("configuration", "not_configured", "runtime_not_configured");
  const body = JSON.stringify(input);
  if (encoder.encode(body).byteLength > RUNTIME_CONTROL_BYTES) return fail("validation", "request_rejected", "body_too_large");
  const headers = await signedHeaders(config.authSecret!, "POST", RUNTIME_CONTROL_PATH, body, nonce);
  const diagnostic = input.operation === "runs.diagnose";
  let response: Response;
  try {
    response = await post(target, headers, body, diagnostic ? RUNTIME_MANAGEMENT_DIAGNOSTIC_TIMEOUT_MS : input.operation === "provider" ? 120_000 : 30_000);
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
    if (diagnostic) {
      const dependencies = managementDependenciesSchema.safeParse(wire.result);
      if (!dependencies.success || evidence?.result !== "ok" || !evidence.authenticated ||
        !evidence.protocolCompatible || !evidence.noncePersisted || !evidence.accepted || !evidence.dispatched)
        return fail("response", "malformed_response");
      return {
        schema: RUNTIME_MANAGEMENT_DIAGNOSTIC_SCHEMA, management: observe("complete", "ok"), dependencies: dependencies.data,
      } satisfies RuntimeManagementDiagnostic as T;
    }
    if (input.operation === "runs.list" && !Array.isArray(wire.result)) return fail("response", "malformed_response");
    observe("complete", "ok");
    return wire.result as T;
  }
  if (response.ok || wire.ok !== false) return fail("response", "malformed_response");
  const code = runtimeControlErrorCodeSchema.safeParse(wire.code ?? wire.error?.code).data;
  if (!code) return fail("response", "malformed_response");
  if (evidence) {
    const serviceFailure = ["authentication_failed", "protocol_incompatible", "management_unavailable",
      "nonce_persistence_unavailable", "storage_query_unavailable", "storage_data_invalid"].includes(evidence.result);
    return fail(evidence.stage, evidence.result, serviceFailure && code !== "github_broker_unavailable" ? "runtime_unavailable" : code);
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

export async function diagnoseRuntimeManagement(
  config: ADTRuntimeConfiguration,
  scope: Extract<RuntimeControlCommand, { operation: "runs.diagnose" }>["scope"],
): Promise<RuntimeManagementDiagnostic> {
  try {
    return await runtimeControl(config, { operation: "runs.diagnose", repositoryId: scope.repositoryId, scope });
  } catch (error) {
    if (!(error instanceof RuntimeManagementError)) throw error;
    const unknown = { status: "not_verified" as const };
    return {
      schema: RUNTIME_MANAGEMENT_DIAGNOSTIC_SCHEMA,
      management: error.observation,
      dependencies: { postgres: unknown, checkpoints: unknown, workflow: unknown, broker: unknown },
    };
  }
}

const credentialSchema = z.object({
  token: z.string().min(1).max(4_096), expiresAt: z.string(),
  permissions: z.object({ contents: z.enum(["read", "write"]).optional(), pull_requests: z.enum(["read", "write"]).optional() }).passthrough(),
});
export async function requestRepositoryCredential(config: { base?: string; authSecret?: string }, input: RepositoryBrokerRequest, timeoutMs = 30_000) {
  try {
    const target = serviceTarget(config.base, config.authSecret, RUNTIME_REPOSITORY_BROKER_PATH);
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
