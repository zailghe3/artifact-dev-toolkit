import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { artifactFrontMatterSchema } from "@/lib/artifact-contract";
import { artifactWriteErrorResponse } from "@/lib/artifact-write-http";
import { updateArtifact } from "@/lib/artifacts";

const payloadSchema = z.object({ metadata: artifactFrontMatterSchema, body: z.string().min(1), currentFileSha: z.string().min(1) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await requireApiRepositoryAccess(request);
  if (authorization instanceof Response) return authorization;
  let value: unknown;
  try { value = await request.json(); } catch { return NextResponse.json({ error: "Artifact input is invalid", code: "validation_failed" }, { status: 400, headers: noStoreHeaders }); }
  const payload = payloadSchema.safeParse(value);
  if (!payload.success) return NextResponse.json({ error: "Artifact input is invalid", code: "validation_failed" }, { status: 400, headers: noStoreHeaders });
  try {
    const result = await updateArtifact(authorization.access, { id: (await params).id, ...payload.data, actorLogin: authorization.session.login });
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) { return artifactWriteErrorResponse(error); }
}
