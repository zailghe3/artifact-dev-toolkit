import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { noStoreHeaders, safeReturnTo } from "@/lib/auth-core";
import { browserMutationRejection } from "@/lib/request-origin";

function redirectTarget(request: Request) {
  return new URL(safeReturnTo(new URL(request.url).searchParams.get("returnTo")), request.url);
}

export async function GET(request: Request) {
  return NextResponse.redirect(redirectTarget(request), { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const rejected = browserMutationRejection(request, "form");
  if (rejected) return rejected;
  await destroySession();
  return NextResponse.redirect(redirectTarget(request), { status: 303, headers: noStoreHeaders });
}
