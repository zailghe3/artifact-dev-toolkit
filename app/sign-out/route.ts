import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { noStoreHeaders, safeReturnTo } from "@/lib/auth-core";

function redirectTarget(request: Request) {
  return new URL(safeReturnTo(new URL(request.url).searchParams.get("returnTo") ?? "/sign-in"), request.url);
}

export async function GET(request: Request) {
  return NextResponse.redirect(redirectTarget(request), { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  await destroySession();
  return NextResponse.redirect(redirectTarget(request), { headers: noStoreHeaders });
}
