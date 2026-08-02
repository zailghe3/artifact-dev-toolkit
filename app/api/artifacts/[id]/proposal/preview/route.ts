import { requireApiRepositoryAccess } from "@/lib/auth";
import { getArtifactWithRevision, proposeArtifactUpdate } from "@/lib/artifacts";
import { handleProposalPreview } from "@/lib/proposal-route-handler";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleProposalPreview(request, (await params).id, { authorize: requireApiRepositoryAccess, loadArtifact: getArtifactWithRevision, propose: proposeArtifactUpdate });
}
