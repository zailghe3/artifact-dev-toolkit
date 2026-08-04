import { NextResponse } from "next/server";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { createArtifact, getArtifacts } from "@/lib/artifacts";
import { searchArtifacts } from "@/lib/search";
import { artifactFrontMatterSchema, normalizeArtifactMetadata } from "@/lib/artifact-contract";
import { artifactWriteErrorResponse } from "@/lib/artifact-write-http";
import { z } from "zod";
import { mapOperationalError } from "@/lib/operational-errors";

const writePayloadSchema = z.object({ metadata: artifactFrontMatterSchema, body: z.string().min(1) });

export async function POST(request: Request) {
  const authorization = await requireApiRepositoryAccess(request);
  if (authorization instanceof Response) return authorization;
  let value: unknown;
  try { value = await request.json(); } catch { return NextResponse.json({ error: "Artifact input is invalid", code: "validation_failed" }, { status: 400, headers: noStoreHeaders }); }
  const payload = writePayloadSchema.safeParse(value);
  if (!payload.success) return NextResponse.json({ error: "Artifact input is invalid", code: "validation_failed" }, { status: 400, headers: noStoreHeaders });
  try {
    const result = await createArtifact(authorization.access, { ...payload.data, actorLogin: authorization.session.login });
    return NextResponse.json({ ...result, canonicalTitle: normalizeArtifactMetadata(payload.data.metadata).title }, { status: 201, headers: noStoreHeaders });
  } catch (error) { return artifactWriteErrorResponse(error); }
}

export async function GET(request: Request) {
  const authorization = await requireApiRepositoryAccess(request);
  if (authorization instanceof Response) return authorization;
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  try {
    const artifacts = searchArtifacts(await getArtifacts(authorization.access), query);
    return NextResponse.json({ artifacts }, { headers: noStoreHeaders });
  } catch (error) {
    const state = mapOperationalError(error);
    return NextResponse.json({ error: state.title, code: state.category, guidance: state.guidance, retry: state.retry }, { status: state.status, headers: noStoreHeaders });
  }
}
