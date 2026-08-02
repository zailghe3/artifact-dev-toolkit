import { z } from "zod";
import { noStoreHeaders, type SessionRecord } from "./auth-core.ts";
import { artifactWriteErrorResponse } from "./artifact-write-http.ts";
import type { Artifact, CreateVariationResult } from "./artifact-repository.ts";
import type { RepositoryAccessContext } from "./repository-authorization.ts";

const payloadSchema = z.object({ title: z.string().trim().optional(), body: z.string().trim().min(1) });
type Authorization = { access: RepositoryAccessContext; session: SessionRecord } | Response;

export type VariationRouteDependencies = {
  authorize(request: Request): Promise<Authorization>;
  loadArtifact(access: RepositoryAccessContext, id: string): Promise<Artifact | undefined>;
  persistVariation(access: RepositoryAccessContext, source: Artifact, body: string, actorLogin: string, title?: string): Promise<CreateVariationResult>;
};

function json(body: unknown, status: number) { return Response.json(body, { status, headers: noStoreHeaders }); }

export async function handleVariationPost(request: Request, id: string, dependencies: VariationRouteDependencies) {
  const authorization = await dependencies.authorize(request);
  if (authorization instanceof Response) return authorization;
  let value: unknown;
  try { value = await request.json(); } catch { return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400); }
  const payload = payloadSchema.safeParse(value);
  if (!payload.success) return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400);
  try {
    const source = await dependencies.loadArtifact(authorization.access, id);
    if (!source) return json({ error: "Artifact not found", code: "artifact_not_found" }, 404);
    const result = await dependencies.persistVariation(authorization.access, source, payload.data.body, authorization.session.login, payload.data.title);
    return json(result, 201);
  } catch (error) { return artifactWriteErrorResponse(error); }
}
