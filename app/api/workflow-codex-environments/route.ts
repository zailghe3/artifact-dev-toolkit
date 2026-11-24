import { NextResponse } from "next/server";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { getWorkflowCodexEnvironmentStore } from "@/lib/workflow-services";
import { readBoundedJson, workflowError } from "@/lib/workflow-http";
import { codexEnvironmentInputSchema, operationalIdempotencyKeySchema } from "@/adt-runtime/src/operational-settings-contract";

function getIdempotencyKey(request: Request) {
  return operationalIdempotencyKeySchema.parse(request.headers.get("idempotency-key") ?? crypto.randomUUID());
}

export async function GET(request: Request) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  try {
    const store = await getWorkflowCodexEnvironmentStore(auth.access.repositoryId);
    return NextResponse.json({ environments: await store.list() }, { headers: noStoreHeaders });
  } catch (error) {
    return workflowError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  try {
    const input = codexEnvironmentInputSchema.parse(await readBoundedJson(request, 2048));
    const store = await getWorkflowCodexEnvironmentStore(auth.access.repositoryId);
    return NextResponse.json(await store.upsert(input, getIdempotencyKey(request)), { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return workflowError(error);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  try {
    const key = codexEnvironmentInputSchema.shape.key.parse(new URL(request.url).searchParams.get("key"));
    const store = await getWorkflowCodexEnvironmentStore(auth.access.repositoryId);
    await store.remove(key, getIdempotencyKey(request));
    return new Response(null, { status: 204, headers: noStoreHeaders });
  } catch (error) {
    return workflowError(error);
  }
}
