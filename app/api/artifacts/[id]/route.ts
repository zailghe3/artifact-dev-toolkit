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
import {createWorkflowDefinitionRepository} from "@/lib/workflow-services";

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
  const id=(await params).id;
  return handleDirectDeletion(request, id, { authorize:async request=>{const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;const references=(await createWorkflowDefinitionRepository(auth.access).listAgents()).filter(({definition})=>definition.prompt.source==="artifact"&&definition.prompt.artifactId===id);return references.length?NextResponse.json({code:"artifact_in_use",error:`This prompt is referenced by ${references.length} Agents and cannot be deleted. Remove or replace those references first.`,agents:references.map(({definition})=>({id:definition.id,name:definition.name}))},{status:409,headers:noStoreHeaders}):auth}, load: getArtifactWithRevision, remove: deleteArtifact });
}
