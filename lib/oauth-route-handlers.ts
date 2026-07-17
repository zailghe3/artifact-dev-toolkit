import { AuthenticationConfigurationError } from "./auth-configuration.ts";
import { noStoreHeaders, safeReturnTo, type OAuthErrorCode } from "./auth-core.ts";
import type { GitHubUser } from "./auth-core.ts";
import type { RepositoryAuthorizationStatus } from "./repository-authorization.ts";

type Logger = (message: string) => void;
type OAuthState = { valid: boolean; returnTo: string; pkceVerifier?: string };
type ExchangeResult = { user: GitHubUser; repositoryAuthorization: RepositoryAuthorizationStatus; userAccessToken: string; userTokenExpiresAt: number };

function redirect(request: Request, pathname: string, parameters: Record<string, string> = {}) {
  const target = new URL(pathname, request.url);
  for (const [name, value] of Object.entries(parameters)) target.searchParams.set(name, value);
  return new Response(null, { status: 307, headers: { ...noStoreHeaders, location: target.toString() } });
}

function log(logger: Logger, event: string, category: string, missingNames?: string[]) {
  logger(JSON.stringify({ event, category, ...(missingNames ? { missingNames } : {}) }));
}

export function createOAuthStartRouteHandler(dependencies: { createOAuthStart: (returnTo: string) => Promise<URL>; logger?: Logger }) {
  return async function GET(request: Request) {
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
    try {
      return new Response(null, { status: 307, headers: { ...noStoreHeaders, location: (await dependencies.createOAuthStart(returnTo)).toString() } });
    } catch (error) {
      const configuration = error instanceof AuthenticationConfigurationError;
      log(dependencies.logger ?? console.error, "github_oauth_start_failed", configuration ? "configuration" : "unexpected", configuration ? error.missingNames : undefined);
      return redirect(request, "/sign-in", { error: configuration ? "configuration" : "oauth_start_failed", ...(returnTo === "/" ? {} : { returnTo }) });
    }
  };
}

export function createOAuthCallbackRouteHandler(dependencies: {
  consumeOAuthState: (state: string | null) => Promise<OAuthState>;
  exchangeGitHubCode: (code: string, verifier: string) => Promise<ExchangeResult>;
  createSession: (user: GitHubUser, authorization: RepositoryAuthorizationStatus, token?: string, expiresAt?: number) => Promise<unknown>;
  logger?: Logger;
}) {
  const logger = dependencies.logger ?? console.error;
  const errorRedirect = (request: Request, code: OAuthErrorCode) => redirect(request, "/sign-in", { error: code });
  return async function GET(request: Request) {
    const url = new URL(request.url);
    let state: OAuthState;
    try { state = await dependencies.consumeOAuthState(url.searchParams.get("state")); }
    catch (error) {
      if (error instanceof AuthenticationConfigurationError) { log(logger, "github_oauth_callback_failed", "configuration", error.missingNames); return errorRedirect(request, "configuration"); }
      log(logger, "github_oauth_callback_failed", "unexpected"); return errorRedirect(request, "github_exchange_failed");
    }
    if (!state.valid) { log(logger, "github_oauth_callback_failed", "invalid_state"); return errorRedirect(request, "invalid_state"); }
    if (url.searchParams.has("error")) { log(logger, "github_oauth_callback_failed", "authorization_denied"); return errorRedirect(request, "denied"); }
    const code = url.searchParams.get("code");
    if (!code) { log(logger, "github_oauth_callback_failed", "missing_code"); return errorRedirect(request, "missing_code"); }
    try {
      const result = await dependencies.exchangeGitHubCode(code, state.pkceVerifier!);
      try { await dependencies.createSession(result.user, result.repositoryAuthorization, result.userAccessToken, result.userTokenExpiresAt); }
      catch (error) {
        log(logger, "github_oauth_callback_failed", error instanceof AuthenticationConfigurationError ? "session_configuration" : "session_persistence", error instanceof AuthenticationConfigurationError ? error.missingNames : undefined);
        return errorRedirect(request, error instanceof AuthenticationConfigurationError ? "configuration" : "session_creation_failed");
      }
      return redirect(request, result.repositoryAuthorization.ok ? state.returnTo : "/access-denied");
    } catch (error) {
      if (error instanceof AuthenticationConfigurationError) { log(logger, "github_oauth_callback_failed", "repository_configuration", error.missingNames); return errorRedirect(request, "configuration"); }
      const category = (error as { category?: string }).category;
      if (category === "identity_lookup") { log(logger, "github_oauth_callback_failed", category); return errorRedirect(request, "github_identity_failed"); }
      if (category === "token_exchange") { log(logger, "github_oauth_callback_failed", category); return errorRedirect(request, "github_exchange_failed"); }
      log(logger, "github_oauth_callback_failed", "unexpected"); return errorRedirect(request, "github_exchange_failed");
    }
  };
}
