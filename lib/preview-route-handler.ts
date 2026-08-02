import { z } from "zod";
import { noStoreHeaders, type SessionRecord } from "./auth-core.ts";
import { prepareVariation, type Artifact } from "./artifact-repository.ts";
import { markdownToHtml } from "./markdown.ts";
import type { RepositoryAccessContext } from "./repository-authorization.ts";

const payloadSchema = z.object({ title: z.string().trim().optional(), body: z.string().trim().min(1) });
type Authorization = { access: RepositoryAccessContext; session: SessionRecord } | Response;
export type PreviewDependencies = { authorize(request: Request): Promise<Authorization>; loadArtifact(access: RepositoryAccessContext, id: string): Promise<Artifact | undefined> };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: noStoreHeaders });

export async function handleVariationPreview(request: Request, id: string, dependencies: PreviewDependencies) {
  const authorization = await dependencies.authorize(request);
  if (authorization instanceof Response) return authorization;
  let value: unknown;
  try { value = await request.json(); } catch { return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400); }
  const payload = payloadSchema.safeParse(value);
  if (!payload.success) return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400);
  try {
    const source = await dependencies.loadArtifact(authorization.access, id);
    if (!source) return json({ error: "Artifact not found", code: "artifact_not_found" }, 404);
    const { metadata } = prepareVariation(source, payload.data.title);
    return json({ metadata, bodyHtml: await markdownToHtml(payload.data.body), sourceTitle: source.title }, 200);
  } catch { return json({ error: "Preview could not be generated", code: "internal_error" }, 500); }
}
