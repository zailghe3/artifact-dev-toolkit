import { requireApiRepositoryAccess } from "@/lib/auth";
import { getArtifact } from "@/lib/artifacts";
import { handleVariationPreview } from "@/lib/preview-route-handler";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleVariationPreview(request, (await params).id, { authorize: requireApiRepositoryAccess, loadArtifact: getArtifact });
}
