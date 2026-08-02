import { requireApiRepositoryAccess } from "@/lib/auth";
import { createVariation, getArtifact } from "@/lib/artifacts";
import { handleVariationPost } from "@/lib/variation-route-handler";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleVariationPost(request, (await params).id, {
    authorize: requireApiRepositoryAccess,
    loadArtifact: getArtifact,
    persistVariation: createVariation,
  });
}
