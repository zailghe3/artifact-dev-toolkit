import { getCloudflareContext } from "@opennextjs/cloudflare";
import { repositoryBrokerRequestSchema, RUNTIME_REPOSITORY_BROKER_PATH } from "@/adt-runtime/src/runtime-control-contract";
import { runtimeControl } from "@/lib/runtime-service-client";
import { signedHeaders } from "@/lib/adt-runtime-client";
import { constantTimeEqual, noStoreHeaders } from "@/lib/auth-core";
import { readBoundedText } from "@/lib/bounded-json";
import { brokerRepositoryCredential } from "@/lib/runtime-repository-authority";

const expiration = 5 * 60_000;
function reject(code: string, status: number) {
  return Response.json({ protocolVersion: "adt-runtime-v1", ok: false, code }, { status, headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const secret = (env as unknown as Record<string,string>).ADT_RUNTIME_AUTH_SECRET;
  const timestamp = request.headers.get("x-adt-timestamp") ?? "";
  const nonce = request.headers.get("x-adt-nonce") ?? "";
  const signature = request.headers.get("x-adt-signature") ?? "";
  const now = Date.now();
  if (!secret || secret.length < 32 || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > expiration ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
      request.headers.get("x-adt-protocol") !== "adt-runtime-v1") return reject("permission_denied", 401);

  try {
    const body = await readBoundedText(request, 8192);
    const expected = await signedHeaders(secret, "POST", RUNTIME_REPOSITORY_BROKER_PATH, body, nonce, timestamp);
    if (!constantTimeEqual(expected["x-adt-signature"], signature) ||
        !constantTimeEqual(expected["x-adt-content-sha256"], request.headers.get("x-adt-content-sha256") ?? "")) {
      return reject("permission_denied", 401);
    }
    const parsed = repositoryBrokerRequestSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return reject("invalid_request", 400);
    const claimed = await runtimeControl<boolean>({ baseUrl: env.ADT_RUNTIME_BASE_URL, authSecret: secret },
      { operation: "broker.claim", nonce, timestamp: Number(timestamp) });
    if (claimed !== true) return reject("permission_denied", 401);
    const result = await brokerRepositoryCredential(parsed.data, env as unknown as Record<string,string>);
    return Response.json({ protocolVersion: "adt-runtime-v1", ok: true, result }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof Error && ["invalid_json", "body_too_large"].includes(error.message)) return reject("invalid_request", 400);
    if (error instanceof Error && error.message === "permission_denied") return reject("permission_denied", 403);
    return reject("github_broker_unavailable", 503);
  }
}
