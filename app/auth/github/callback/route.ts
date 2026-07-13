import { NextResponse } from "next/server";
import { consumeOAuthState, createSession, exchangeGitHubCode } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";

function redirectWithError(request: Request, message: string) {
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url, { headers: noStoreHeaders });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { valid, returnTo } = await consumeOAuthState(url.searchParams.get("state"));

  const error = url.searchParams.get("error");
  if (error) return redirectWithError(request, "GitHub authorization was denied or cancelled.");
  if (!valid) return redirectWithError(request, "The sign-in request expired or could not be verified. Please try again.");

  const code = url.searchParams.get("code");
  if (!code) return redirectWithError(request, "GitHub did not return an authorization code. Please try again.");

  try {
    await createSession(await exchangeGitHubCode(code));
    return NextResponse.redirect(new URL(returnTo, request.url), { headers: noStoreHeaders });
  } catch (caught) {
    return redirectWithError(request, caught instanceof Error ? caught.message : "GitHub sign-in failed. Please try again.");
  }
}
