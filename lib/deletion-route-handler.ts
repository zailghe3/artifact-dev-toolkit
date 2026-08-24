import { z } from "zod";
import { noStoreHeaders, type SessionRecord } from "./auth-core.ts";
import { artifactWriteErrorResponse } from "./artifact-write-http.ts";
import { ArtifactWriteConflictError, type ArtifactDeleteResult, type ArtifactWithRevision, type DeleteArtifactInput } from "./artifact-repository.ts";
import type { RepositoryAccessContext } from "./repository-authorization.ts";
const schema = z.object({ currentFileSha: z.string().trim().min(1) }).strict();
type Authorization = { access: RepositoryAccessContext; session: SessionRecord } | Response;
type Common = { authorize(request: Request): Promise<Authorization>; load(access: RepositoryAccessContext, id: string): Promise<ArtifactWithRevision | undefined> };
export type DirectDeletionDependencies = Common & { remove(access: RepositoryAccessContext, input: DeleteArtifactInput): Promise<ArtifactDeleteResult> };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: noStoreHeaders });
async function authorizeAndParse(request: Request, authorize: Common["authorize"]) { const authorization = await authorize(request); if (authorization instanceof Response) return authorization; let value: unknown; try { value = await request.json(); } catch { return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400); } const payload = schema.safeParse(value); return payload.success ? { authorization, sha: payload.data.currentFileSha } : json({ error: "Artifact input is invalid", code: "validation_failed" }, 400); }
export async function handleDirectDeletion(request: Request, id: string, dependencies: DirectDeletionDependencies) {
  const parsed = await authorizeAndParse(request, dependencies.authorize); if (parsed instanceof Response) return parsed;
  try { const stored = await dependencies.load(parsed.authorization.access, id); if (!stored) return json({ error: "Artifact not found", code: "artifact_not_found" }, 404); if (stored.currentFileSha !== parsed.sha) throw new ArtifactWriteConflictError(); return json(await dependencies.remove(parsed.authorization.access, { id, currentFileSha: parsed.sha, actorLogin: parsed.authorization.session.login }), 200); } catch (error) { return artifactWriteErrorResponse(error); }
}
