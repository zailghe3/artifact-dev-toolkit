import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { proposeArtifactDeletion } from "@/lib/artifacts";
import { artifactWriteErrorResponse } from "@/lib/artifact-write-http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await requireApiRepositoryAccess(request);
  if (authorization instanceof Response) return authorization;
  let value: unknown; try { value = await request.json(); } catch { return NextResponse.json({ error: "Artifact input is invalid", code: "validation_failed" }, { status: 400, headers: noStoreHeaders }); }
  const payload = z.object({ currentFileSha: z.string().min(1) }).safeParse(value);
  if (!payload.success) return NextResponse.json({ error: "Artifact input is invalid", code: "validation_failed" }, { status: 400, headers: noStoreHeaders });
  try { return NextResponse.json(await proposeArtifactDeletion(authorization.access, { id: (await params).id, currentFileSha: payload.data.currentFileSha, actorLogin: authorization.session.login }), { status: 201, headers: noStoreHeaders }); }
  catch (error) { return artifactWriteErrorResponse(error); }
}
