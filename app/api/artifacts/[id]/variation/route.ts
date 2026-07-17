import { NextResponse } from "next/server";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { z } from "zod";
import { createVariation, getArtifact } from "@/lib/artifacts";

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

  const payload = payloadSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json({ error: payload.error.flatten().fieldErrors }, { status: 400, headers: noStoreHeaders });
  }

  try {
    const variationId = await createVariation(authorization.access, source, payload.data.body, payload.data.title);
    return NextResponse.json({ id: variationId }, { status: 201, headers: noStoreHeaders });
  } catch {
    return NextResponse.json({ error: "Variation could not be created" }, { status: 400, headers: noStoreHeaders });
  }
}
