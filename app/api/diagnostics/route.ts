import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/auth-core";
import { requireApiDiagnosticsAccess } from "@/lib/auth";
import { generateRepositoryDiagnostics } from "@/lib/repository-diagnostics";

export const dynamic = "force-dynamic";
export async function GET(request: Request) { const session = await requireApiDiagnosticsAccess(request); if (session instanceof Response) return session; try { return NextResponse.json(await generateRepositoryDiagnostics(session), { headers: noStoreHeaders }); } catch { return NextResponse.json({ error: "Diagnostics temporarily unavailable", code: "diagnostics_unavailable" }, { status: 503, headers: noStoreHeaders }); } }
