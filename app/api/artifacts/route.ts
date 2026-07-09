import { NextResponse } from "next/server";
import { getArtifacts, searchArtifacts } from "@/lib/artifacts";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const artifacts = searchArtifacts(await getArtifacts(), query);
  return NextResponse.json({ artifacts });
}
