import { requireApiRepositoryAccess } from "@/lib/auth";
import { getArtifactWithRevision } from "@/lib/artifacts";
import { handleLifecyclePreview } from "@/lib/lifecycle-preview-route-handler";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return handleLifecyclePreview(request, (await params).id, { authorize: requireApiRepositoryAccess, loadArtifact: getArtifactWithRevision }); }
