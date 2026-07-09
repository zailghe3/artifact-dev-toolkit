import { NextResponse } from "next/server";
import { z } from "zod";
import { createVariation, getArtifact } from "@/lib/artifacts";

const payloadSchema = z.object({
  title: z.string().optional(),
  body: z.string().min(1, "Variation body is required"),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await getArtifact(id);
  if (!source) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const payload = payloadSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json({ error: payload.error.flatten().fieldErrors }, { status: 400 });
  }

  const variationId = await createVariation(source, payload.data.body, payload.data.title);
  return NextResponse.json({ id: variationId }, { status: 201 });
}
