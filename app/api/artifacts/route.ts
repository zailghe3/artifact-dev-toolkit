import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { getArtifacts } from "@/lib/artifacts";
import { searchArtifacts } from "@/lib/search";

export async function GET(request: Request) {
  const authError = await requireApiAuth(request);
  if (authError) return authError;
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const artifacts = searchArtifacts(await getArtifacts(), query);
  return NextResponse.json({ artifacts }, { headers: noStoreHeaders });
}
