import { NextResponse } from "next/server";
import { consumeOAuthState, createSession, exchangeGitHubCode } from "@/lib/auth";
import { noStoreHeaders, type OAuthErrorCode } from "@/lib/auth-core";

function redirectWithError(request: Request, code: OAuthErrorCode) {
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url, { headers: noStoreHeaders });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { valid, returnTo } = await consumeOAuthState(url.searchParams.get("state"));
  if (!valid) return redirectWithError(request, "invalid_state");

  const error = url.searchParams.get("error");
  if (error) return redirectWithError(request, "denied");

  const code = url.searchParams.get("code");
  if (!code) return redirectWithError(request, "missing_code");

  try {
    const user = await exchangeGitHubCode(code);
    try {
      await createSession(user);
    } catch {
      return redirectWithError(request, "session_creation_failed");
    }
    return NextResponse.redirect(new URL(returnTo, request.url), { headers: noStoreHeaders });
  } catch (caught) {
    return redirectWithError(request, caught instanceof Error && caught.message === "github_identity_failed" ? "github_identity_failed" : "github_exchange_failed");
  }
}
