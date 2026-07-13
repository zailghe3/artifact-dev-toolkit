import { NextResponse } from "next/server";
import { createOAuthStart } from "@/lib/auth";
import { noStoreHeaders, safeReturnTo } from "@/lib/auth-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const authorizeUrl = await createOAuthStart(safeReturnTo(url.searchParams.get("returnTo")));
  return NextResponse.redirect(authorizeUrl, { headers: noStoreHeaders });
}
