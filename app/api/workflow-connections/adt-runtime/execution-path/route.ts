import { NextResponse } from "next/server";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { readBoundedText } from "@/lib/bounded-json";
import { diagnoseADTRuntimeExecutionPath } from "@/lib/workflow-services";

export async function POST(request: Request) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Request origin is invalid." }, { status: 403, headers: noStoreHeaders });
  }
  try {
    const value: unknown = JSON.parse(await readBoundedText(request, 1024));
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) throw new Error();
  } catch {
    return NextResponse.json({ error: "Request body is invalid." }, { status: 400, headers: noStoreHeaders });
  }
  return NextResponse.json(await diagnoseADTRuntimeExecutionPath(auth.access), { headers: noStoreHeaders });
}
