import { NextResponse } from "next/server";
import { requireApiDiagnosticsAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { getInfrastructureFreshnessSnapshot } from "@/lib/infrastructure-freshness-live";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireApiDiagnosticsAccess(request);
  if (session instanceof Response) return session;
  try {
    const authorization = session.repositoryAuthorization;
    return NextResponse.json(await getInfrastructureFreshnessSnapshot({ repositoryId: authorization.repositoryId!, installationId: authorization.installationId!, owner: authorization.owner, repository: authorization.repo }), { headers: noStoreHeaders });
  } catch {
    return NextResponse.json(
      {
        state: "unknown",
        checkedAt: new Date().toISOString(),
        components: {
          worker: { state: "unknown", unknownReason: "github_access_unavailable" },
          runtime: { state: "unknown", unknownReason: "github_access_unavailable" },
          runner: { state: "unknown", unknownReason: "github_access_unavailable" },
        },
      },
      { headers: noStoreHeaders },
    );
  }
}
