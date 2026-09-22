import { NextResponse } from "next/server";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { generateRepositoryDiagnostics } from "@/lib/repository-diagnostics";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  try { return NextResponse.json(await generateRepositoryDiagnostics(auth.session)); }
  catch { return NextResponse.json({ error: "repository_diagnostics_unavailable" }, { status: 503 }); }
}
