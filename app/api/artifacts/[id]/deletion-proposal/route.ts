import { requireApiRepositoryAccess } from "@/lib/auth";
import { getArtifactWithRevision, proposeArtifactDeletion } from "@/lib/artifacts";
import { handleDeletionProposal } from "@/lib/deletion-route-handler";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return handleDeletionProposal(request, (await params).id, { authorize: requireApiRepositoryAccess, load: getArtifactWithRevision, propose: proposeArtifactDeletion }); }
