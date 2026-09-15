import { NextResponse } from "next/server";
import { requireApiDiagnosticsAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { getInfrastructureFreshnessSnapshot } from "@/lib/infrastructure-freshness-live";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireApiDiagnosticsAccess(request);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json(await getInfrastructureFreshnessSnapshot(), { headers: noStoreHeaders });
  } catch {
    return NextResponse.json(
      {
        state: "unknown",
        checkedAt: new Date().toISOString(),
        components: {
          worker: { state: "unknown" },
          runtime: { state: "unknown" },
          runner: { state: "unknown" },
        },
      },
      { headers: noStoreHeaders },
    );
  }
}
