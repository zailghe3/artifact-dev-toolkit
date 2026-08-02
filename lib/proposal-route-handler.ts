import { z } from "zod";
import { artifactMetadataSchema } from "./artifact-schemas.ts";
import { noStoreHeaders, type SessionRecord } from "./auth-core.ts";
import { artifactWriteErrorResponse } from "./artifact-write-http.ts";
import type { ArtifactProposalResult, ArtifactWithRevision, ProposeArtifactUpdateInput } from "./artifact-repository.ts";
import type { RepositoryAccessContext } from "./repository-authorization.ts";
import { markdownToHtml } from "./markdown.ts";

const payloadSchema = z.object({ metadata: artifactMetadataSchema, body: z.string().trim().min(1), currentFileSha: z.string().trim().min(8) });
type Authorization = { access: RepositoryAccessContext; session: SessionRecord } | Response;
export type ProposalRouteDependencies = {
  authorize(request: Request): Promise<Authorization>;
  loadArtifact(access: RepositoryAccessContext, id: string): Promise<ArtifactWithRevision | undefined>;
  propose(access: RepositoryAccessContext, input: ProposeArtifactUpdateInput): Promise<ArtifactProposalResult>;
};
const json = (body: unknown, status: number) => Response.json(body, { status, headers: noStoreHeaders });

export async function handleProposalPost(request: Request, id: string, dependencies: ProposalRouteDependencies) {
  const authorization = await dependencies.authorize(request);
  if (authorization instanceof Response) return authorization;
  let value: unknown;
  try { value = await request.json(); } catch { return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400); }
  const payload = payloadSchema.safeParse(value);
  if (!payload.success || payload.data.metadata.id !== id) return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400);
  try {
    const source = await dependencies.loadArtifact(authorization.access, id);
    if (!source) return json({ error: "Artifact not found", code: "artifact_not_found" }, 404);
    if (source.artifact.status !== "production") return json({ error: "Production proposals require a production artifact", code: "proposal_requires_production_artifact" }, 400);
    if (source.currentFileSha !== payload.data.currentFileSha) return json({ error: "Artifact changed since it was loaded", code: "write_conflict" }, 409);
    const result = await dependencies.propose(authorization.access, { id, ...payload.data, actorLogin: authorization.session.login });
    return json(result, 201);
  } catch (error) { return artifactWriteErrorResponse(error); }
}

export async function handleProposalPreview(request: Request, id: string, dependencies: ProposalRouteDependencies) {
  const authorization = await dependencies.authorize(request);
  if (authorization instanceof Response) return authorization;
  let value: unknown;
  try { value = await request.json(); } catch { return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400); }
  const payload = payloadSchema.safeParse(value);
  if (!payload.success || payload.data.metadata.id !== id) return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400);
  try {
    const source = await dependencies.loadArtifact(authorization.access, id);
    if (!source) return json({ error: "Artifact not found", code: "artifact_not_found" }, 404);
    if (source.artifact.status !== "production") return json({ error: "Production proposals require a production artifact", code: "proposal_requires_production_artifact" }, 400);
    return json({ metadata: payload.data.metadata, bodyHtml: await markdownToHtml(payload.data.body) }, 200);
  } catch { return json({ error: "Preview could not be generated", code: "internal_error" }, 500); }
}
