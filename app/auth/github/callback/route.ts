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
  const { valid, returnTo, pkceVerifier } = await consumeOAuthState(url.searchParams.get("state"));
  if (!valid) return redirectWithError(request, "invalid_state");

  const error = url.searchParams.get("error");
  if (error) return redirectWithError(request, "denied");

  const code = url.searchParams.get("code");
  if (!code) return redirectWithError(request, "missing_code");

  try {
    const { user, repositoryAuthorization, userAccessToken, userTokenExpiresAt } = await exchangeGitHubCode(code, pkceVerifier!);
    try {
      await createSession(user, repositoryAuthorization, userAccessToken, userTokenExpiresAt);
    } catch {
      return redirectWithError(request, "session_creation_failed");
    }
    if (!repositoryAuthorization.ok) return NextResponse.redirect(new URL("/access-denied", request.url), { headers: noStoreHeaders });
    return NextResponse.redirect(new URL(returnTo, request.url), { headers: noStoreHeaders });
  } catch (caught) {
    if (caught instanceof Error && caught.message === "repository_authorization_failed") {
      const reason = (caught as Error & { repositoryAuthorization?: { ok: false; reason: string } }).repositoryAuthorization?.reason ?? "configuration";
      const url = new URL("/access-denied", request.url);
      url.searchParams.set("reason", reason);
      return NextResponse.redirect(url, { headers: noStoreHeaders });
    }
    return redirectWithError(request, caught instanceof Error && caught.message === "github_identity_failed" ? "github_identity_failed" : "github_exchange_failed");
  }
}
