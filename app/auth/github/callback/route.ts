import { consumeOAuthState, createSession, destroySession, exchangeGitHubCode } from "@/lib/auth";
import { createOAuthCallbackRouteHandler } from "@/lib/oauth-route-handlers";

export const GET = createOAuthCallbackRouteHandler({ consumeOAuthState, createSession, destroySession, exchangeGitHubCode });
