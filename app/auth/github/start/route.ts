import { createOAuthStart } from "@/lib/auth";
import { createOAuthStartRouteHandler } from "@/lib/oauth-route-handlers";

export const GET = createOAuthStartRouteHandler({ createOAuthStart });
