import { requireApiRepositoryAccess } from "@/lib/auth";
import { refreshArtifactCatalogue } from "@/lib/artifacts";
import { handleCatalogueRefresh } from "@/lib/catalogue-refresh-route-handler";

export async function POST(request: Request) { return handleCatalogueRefresh(request, { authorize: requireApiRepositoryAccess, refresh: refreshArtifactCatalogue }); }
