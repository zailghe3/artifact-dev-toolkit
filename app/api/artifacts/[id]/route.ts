import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { artifactFrontMatterSchema, normalizeArtifactMetadata } from "@/lib/artifact-contract";
import { artifactWriteErrorResponse } from "@/lib/artifact-write-http";
import { deleteArtifact, getArtifactWithRevision, updateArtifact } from "@/lib/artifacts";
import { handleDirectDeletion } from "@/lib/deletion-route-handler";
import { ArtifactRepositoryAccessError, ArtifactRepositoryUnavailableError } from "@/lib/artifact-repository";
import { canonicalEditorSnapshot } from "@/lib/artifact-editor-helpers";

const payloadSchema = z.object({ metadata: artifactFrontMatterSchema, body: z.string().min(1), currentFileSha: z.string().min(1) });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await requireApiRepositoryAccess(request);
  if (authorization instanceof Response) return authorization;
  try {
    const result = await getArtifactWithRevision(authorization.access, (await params).id);
    if (!result) return NextResponse.json({ error: "Artifact not found", code: "artifact_not_found" }, { status: 404, headers: noStoreHeaders });
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ArtifactRepositoryAccessError) return NextResponse.json({ error: "Repository access denied", code: "repository_access_denied" }, { status: 403, headers: noStoreHeaders });
    if (error instanceof ArtifactRepositoryUnavailableError) return NextResponse.json({ error: "Artifact repository temporarily unavailable", code: "repository_unavailable" }, { status: 503, headers: noStoreHeaders });
    return NextResponse.json({ error: "Artifact could not be read", code: "internal_error" }, { status: 500, headers: noStoreHeaders });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await requireApiRepositoryAccess(request);
  if (authorization instanceof Response) return authorization;
  let value: unknown;
  try { value = await request.json(); } catch { return NextResponse.json({ error: "Artifact input is invalid", code: "validation_failed" }, { status: 400, headers: noStoreHeaders }); }
  const payload = payloadSchema.safeParse(value);
  if (!payload.success) return NextResponse.json({ error: "Artifact input is invalid", code: "validation_failed" }, { status: 400, headers: noStoreHeaders });
  try {
    const result = await updateArtifact(authorization.access, { id: (await params).id, ...payload.data, actorLogin: authorization.session.login });
    const canonical = canonicalEditorSnapshot({ ...payload.data.metadata, body: payload.data.body });
    return NextResponse.json({ ...result, canonicalTitle: normalizeArtifactMetadata(payload.data.metadata).title, canonicalEditor: canonical }, { headers: noStoreHeaders });
  } catch (error) { return artifactWriteErrorResponse(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleDirectDeletion(request, (await params).id, { authorize: requireApiRepositoryAccess, load: getArtifactWithRevision, remove: deleteArtifact });
}
