import { z } from "zod";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { refreshArtifactCatalogue } from "@/lib/artifacts";
import { ArtifactRepositoryAccessError, ArtifactRepositoryUnavailableError } from "@/lib/artifact-repository";

export async function POST(request: Request) {
  const authorization = await requireApiRepositoryAccess(request);
  if (authorization instanceof Response) return authorization;
  let input: unknown = {};
  try { input = await request.json(); } catch { /* An empty body means a revision check. */ }
  const parsed = z.object({ full: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return Response.json({ error: "Invalid refresh request", code: "validation_failed" }, { status: 400, headers: noStoreHeaders });
  try {
    const { revision, refreshedAt, cacheState, staleReason } = await refreshArtifactCatalogue(authorization.access, parsed.data.full ?? false);
    return Response.json({ revision, refreshedAt, cacheState, ...(staleReason ? { staleReason } : {}) }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ArtifactRepositoryAccessError) return Response.json({ error: "Repository access denied", code: "repository_access_denied" }, { status: 403, headers: noStoreHeaders });
    if (error instanceof ArtifactRepositoryUnavailableError) return Response.json({ error: "Artifact repository temporarily unavailable", code: "repository_unavailable" }, { status: 503, headers: noStoreHeaders });
    return Response.json({ error: "Catalogue refresh failed", code: "refresh_failed" }, { status: 500, headers: noStoreHeaders });
  }
}
