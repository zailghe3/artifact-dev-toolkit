import { z } from "zod";
import { artifactFrontMatterSchema } from "./artifact-contract.ts";
import { noStoreHeaders, type SessionRecord } from "./auth-core.ts";
import { ArtifactSecretRejectedError, ArtifactWriteTooLargeError, ArtifactWriteValidationError, prepareArtifactWrite, validateImmutableLifecycleMetadata, type ArtifactWithRevision } from "./artifact-repository.ts";
import { markdownToHtml } from "./markdown.ts";
import type { RepositoryAccessContext } from "./repository-authorization.ts";

const schema = z.object({ metadata: artifactFrontMatterSchema, body: z.string().min(1), currentFileSha: z.string().min(1).optional() });
type Authorization = { access: RepositoryAccessContext; session: SessionRecord } | Response;
export type LifecyclePreviewDependencies = { authorize(request: Request): Promise<Authorization>; loadArtifact?: (access: RepositoryAccessContext, id: string) => Promise<ArtifactWithRevision | undefined> };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: noStoreHeaders });

export async function handleLifecyclePreview(request: Request, id: string | undefined, dependencies: LifecyclePreviewDependencies) {
  const authorization = await dependencies.authorize(request);
  if (authorization instanceof Response) return authorization;
  let value: unknown; try { value = await request.json(); } catch { return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400); }
  const payload = schema.safeParse(value);
  if (!payload.success) return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400);
  try {
    const { metadata } = prepareArtifactWrite(payload.data.metadata, payload.data.body);
    if (!id) {
      if (metadata.status !== "draft") throw new ArtifactWriteValidationError();
    } else {
      if (!dependencies.loadArtifact || !payload.data.currentFileSha || metadata.id !== id) throw new ArtifactWriteValidationError();
      const stored = await dependencies.loadArtifact(authorization.access, id);
      if (!stored) return json({ error: "Artifact not found", code: "artifact_not_found" }, 404);
      if (stored.currentFileSha !== payload.data.currentFileSha) return json({ error: "Artifact changed since it was loaded", code: "write_conflict" }, 409);
      validateImmutableLifecycleMetadata(stored.artifact, metadata);
    }
    return json({ metadata, bodyHtml: await markdownToHtml(payload.data.body) }, 200);
  } catch (error) {
    if (error instanceof ArtifactWriteTooLargeError) return json({ error: "Artifact exceeds the maximum allowed size", code: "artifact_too_large" }, 413);
    if (error instanceof ArtifactSecretRejectedError) return json({ error: "Artifact content failed the secret safety check", code: "secret_rejected" }, 400);
    if (error instanceof ArtifactWriteValidationError || error instanceof z.ZodError) return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400);
    return json({ error: "Preview could not be generated", code: "internal_error" }, 500);
  }
}
