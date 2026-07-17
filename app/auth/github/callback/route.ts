import { NextResponse } from "next/server";
import { consumeOAuthState, createSession, exchangeGitHubCode } from "@/lib/auth";
import { noStoreHeaders, type OAuthErrorCode } from "@/lib/auth-core";
import { AuthenticationConfigurationError } from "@/lib/auth-configuration";

function logFailure(category: string, missingNames?: string[]) {
  console.error(JSON.stringify({ event: "github_oauth_callback_failed", category, ...(missingNames ? { missingNames } : {}) }));
}

function redirectWithError(request: Request, code: OAuthErrorCode) {
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url, { headers: noStoreHeaders });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  let oauthState: Awaited<ReturnType<typeof consumeOAuthState>>;
  try {
    oauthState = await consumeOAuthState(url.searchParams.get("state"));
  } catch (error) {
    if (error instanceof AuthenticationConfigurationError) {
      logFailure("configuration", error.missingNames);
      return redirectWithError(request, "configuration");
    }
    logFailure("unexpected");
    return redirectWithError(request, "github_exchange_failed");
  }
  const { valid, returnTo, pkceVerifier } = oauthState;
  if (!valid) { logFailure("invalid_state"); return redirectWithError(request, "invalid_state"); }

  const error = url.searchParams.get("error");
  if (error) { logFailure("authorization_denied"); return redirectWithError(request, "denied"); }

  const code = url.searchParams.get("code");
  if (!code) { logFailure("missing_code"); return redirectWithError(request, "missing_code"); }

  try {
    const { user, repositoryAuthorization, userAccessToken, userTokenExpiresAt } = await exchangeGitHubCode(code, pkceVerifier!);
    try {
      await createSession(user, repositoryAuthorization, userAccessToken, userTokenExpiresAt);
    } catch (error) {
      logFailure(error instanceof AuthenticationConfigurationError ? "session_configuration" : "session_persistence", error instanceof AuthenticationConfigurationError ? error.missingNames : undefined);
      return redirectWithError(request, "session_creation_failed");
    }
    if (!repositoryAuthorization.ok) return NextResponse.redirect(new URL("/access-denied", request.url), { headers: noStoreHeaders });
    return NextResponse.redirect(new URL(returnTo, request.url), { headers: noStoreHeaders });
  } catch (caught) {
    if (caught instanceof AuthenticationConfigurationError) {
      logFailure("repository_configuration", caught.missingNames);
      return redirectWithError(request, "configuration");
    }
    const category = (caught as { category?: string }).category;
    if (category === "identity_lookup") { logFailure(category); return redirectWithError(request, "github_identity_failed"); }
    if (category === "token_exchange") { logFailure(category); return redirectWithError(request, "github_exchange_failed"); }
    logFailure("unexpected");
    return redirectWithError(request, "github_exchange_failed");
  }
}
