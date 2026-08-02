import { NextResponse } from "next/server";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { z } from "zod";
import { createVariation, getArtifact } from "@/lib/artifacts";
import { artifactWriteErrorResponse } from "@/lib/artifact-write-http";

const payloadSchema = z.object({
  title: z.string().optional(),
  body: z.string().min(1, "Variation body is required"),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await requireApiRepositoryAccess(request);
  if (authorization instanceof Response) return authorization;
  const { id } = await params;
  const source = await getArtifact(authorization.access, id);
  if (!source) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404, headers: noStoreHeaders });
  }

  let value: unknown;
  try { value = await request.json(); } catch { return NextResponse.json({ error: "Artifact input is invalid", code: "validation_failed" }, { status: 400, headers: noStoreHeaders }); }
  const payload = payloadSchema.safeParse(value);
  if (!payload.success) {
    return NextResponse.json({ error: payload.error.flatten().fieldErrors }, { status: 400, headers: noStoreHeaders });
  }

  try {
    const variationId = await createVariation(authorization.access, source, payload.data.body, authorization.session.login, payload.data.title);
    return NextResponse.json({ id: variationId }, { status: 201, headers: noStoreHeaders });
  } catch (error) { return artifactWriteErrorResponse(error); }
}
