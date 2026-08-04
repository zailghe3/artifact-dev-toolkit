import { requireApiRepositoryAccess } from "@/lib/auth";
import { handleLifecyclePreview } from "@/lib/lifecycle-preview-route-handler";
export async function POST(request: Request) { return handleLifecyclePreview(request, undefined, { authorize: requireApiRepositoryAccess }); }
