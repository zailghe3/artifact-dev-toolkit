import { z } from "zod";
import { noStoreHeaders } from "./auth-core.ts";
import { ArtifactRepositoryAccessError, ArtifactRepositoryUnavailableError } from "./artifact-repository.ts";
import type { ArtifactCatalogueResult } from "./artifact-catalogue.ts";
import type { RepositoryAccessContext } from "./repository-authorization.ts";

type Authorization = { access: RepositoryAccessContext };
export type CatalogueRefreshDependencies = { authorize(request: Request): Promise<Authorization | Response>; refresh(access: RepositoryAccessContext, full: boolean): Promise<ArtifactCatalogueResult | undefined> };
const invalid = () => Response.json({ error: "Invalid refresh request", code: "validation_failed" }, { status: 400, headers: noStoreHeaders });

export async function handleCatalogueRefresh(request: Request, dependencies: CatalogueRefreshDependencies) {
  const authorization = await dependencies.authorize(request); if (authorization instanceof Response) return authorization;
  let input: unknown = {}; const body = await request.text(); if (body.length > 0) { try { input = JSON.parse(body); } catch { return invalid(); } }
  const parsed = z.object({ full: z.boolean().optional() }).strict().safeParse(input); if (!parsed.success) return invalid();
  try {
    const result = await dependencies.refresh(authorization.access, parsed.data.full ?? false);
    if (!result) return Response.json({ error: "Catalogue refresh is unavailable for the local file backend", code: "refresh_unsupported" }, { status: 409, headers: noStoreHeaders });
    const { revision, refreshedAt, cacheState, staleReason } = result;
    return Response.json({ revision, refreshedAt, cacheState, ...(staleReason ? { staleReason } : {}) }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ArtifactRepositoryAccessError) return Response.json({ error: "Repository access denied", code: "repository_access_denied" }, { status: 403, headers: noStoreHeaders });
    if (error instanceof ArtifactRepositoryUnavailableError) return Response.json({ error: "Artifact repository temporarily unavailable", code: "repository_unavailable" }, { status: 503, headers: noStoreHeaders });
    return Response.json({ error: "Catalogue refresh failed", code: "refresh_failed" }, { status: 500, headers: noStoreHeaders });
  }
}
