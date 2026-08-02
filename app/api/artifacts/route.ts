import { NextResponse } from "next/server";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { createArtifact, getArtifacts } from "@/lib/artifacts";
import { searchArtifacts } from "@/lib/search";
import { artifactFrontMatterSchema } from "@/lib/artifact-contract";
import { artifactWriteErrorResponse } from "@/lib/artifact-write-http";
import { z } from "zod";

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
    return NextResponse.json(result, { status: 201, headers: noStoreHeaders });
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
    const errors = await import("@/lib/artifact-repository");
    const unavailable = error instanceof errors.ArtifactRepositoryUnavailableError;
    const denied = error instanceof errors.ArtifactRepositoryAccessError;
    return NextResponse.json({ error: unavailable ? "Artifact repository temporarily unavailable" : denied ? "Repository access denied" : "Artifact repository could not be read" }, { status: unavailable ? 503 : denied ? 403 : 500, headers: noStoreHeaders });
  }
}
