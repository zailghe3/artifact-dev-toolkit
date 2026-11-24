import { z } from "zod";
import { RUNTIME_CONTROL_PATH, RUNTIME_CONTROL_BYTES, RUNTIME_REPOSITORY_BROKER_PATH,
  type RuntimeControlCommand, type RepositoryBrokerRequest } from "../adt-runtime/src/runtime-control-contract.ts";
import { signedHeaders, boundedJson, type ADTRuntimeConfiguration } from "./adt-runtime-client.ts";

async function serviceRequest(base: string | undefined, secret: string | undefined, path: string, input: unknown, max: number) {
  if (!base || !secret || secret.length < 32) throw new Error("runtime_not_configured");
  const target = new URL(path, base);
  if (target.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    throw new Error("runtime_not_configured");
  }
  const body = JSON.stringify(input);
  if (Buffer.byteLength(body) > max) throw new Error("body_too_large");
  const headers = await signedHeaders(secret, "POST", path, body, crypto.randomUUID().replaceAll("-", ""));
  let response: Response;
  try {
    response = await fetch(target, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("runtime_unavailable");
  }
  const wire = await boundedJson(response, max) as { protocolVersion?: string; ok?: boolean; result?: unknown; code?: unknown };
  if (wire?.protocolVersion !== "adt-runtime-v1") throw new Error("runtime_unavailable");
  if (response.ok && wire.ok) return wire.result;
  if (typeof wire.code === "string" && /^[a-z][a-z0-9_]{2,79}$/.test(wire.code)) throw new Error(wire.code);
  throw new Error("runtime_unavailable");
}

export async function runtimeControl<T>(config: ADTRuntimeConfiguration, input: RuntimeControlCommand): Promise<T> {
  return await serviceRequest(config.baseUrl, config.authSecret, RUNTIME_CONTROL_PATH, input, RUNTIME_CONTROL_BYTES) as T;
}

const credentialSchema = z.object({
  token: z.string().min(1).max(4_096), expiresAt: z.string(),
  permissions: z.object({ contents: z.enum(["read", "write"]).optional(), pull_requests: z.enum(["read", "write"]).optional() }).passthrough(),
});
export async function requestRepositoryCredential(config: { base?: string; authSecret?: string }, input: RepositoryBrokerRequest) {
  try {
    return credentialSchema.parse(await serviceRequest(config.base, config.authSecret, RUNTIME_REPOSITORY_BROKER_PATH, input, 8_192));
  } catch (error) {
    if (error instanceof Error && error.message === "permission_denied") throw error;
    throw new Error("github_broker_unavailable");
  }
}
