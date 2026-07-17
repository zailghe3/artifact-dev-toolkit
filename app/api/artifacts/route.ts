import { NextResponse } from "next/server";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { getArtifacts } from "@/lib/artifacts";
import { searchArtifacts } from "@/lib/search";

export async function GET(request: Request) {
  const authorization = await requireApiRepositoryAccess(request);
  if (authorization instanceof Response) return authorization;
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  try {
    const artifacts = searchArtifacts(await getArtifacts(authorization.access), query);
    return NextResponse.json({ artifacts }, { headers: noStoreHeaders });
  } catch (error) {
    const unavailable = error instanceof (await import("@/lib/artifact-repository")).ArtifactRepositoryUnavailableError;
    return NextResponse.json({ error: unavailable ? "Artifact repository temporarily unavailable" : "Artifact repository could not be read" }, { status: unavailable ? 503 : 500, headers: noStoreHeaders });
  }
}
