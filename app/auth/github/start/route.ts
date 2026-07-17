import { NextResponse } from "next/server";
import { createOAuthStart } from "@/lib/auth";
import { noStoreHeaders, safeReturnTo } from "@/lib/auth-core";
import { AuthenticationConfigurationError } from "@/lib/auth-configuration";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  try {
    const authorizeUrl = await createOAuthStart(returnTo);
    return NextResponse.redirect(authorizeUrl, { headers: noStoreHeaders });
  } catch (error) {
    const configuration = error instanceof AuthenticationConfigurationError;
    console.error(JSON.stringify({ event: "github_oauth_start_failed", category: configuration ? "configuration" : "unexpected", ...(configuration && error.missingNames ? { missingNames: error.missingNames } : {}) }));
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("error", configuration ? "configuration" : "oauth_start_failed");
    if (returnTo !== "/") signIn.searchParams.set("returnTo", returnTo);
    return NextResponse.redirect(signIn, { headers: noStoreHeaders });
  }
}
