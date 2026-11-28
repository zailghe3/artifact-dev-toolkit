// OpenNext generates this module before Wrangler bundles the custom entrypoint.
// @ts-expect-error generated build output has no source-time declaration
import nextWorker from "./.open-next/worker.js";
import { noStoreHeaders } from "./lib/auth-core.ts";

export default {
  ...nextWorker,
  async fetch(request: Request, env: CloudflareEnv, context: ExecutionContext) {
    const response: Response = await nextWorker.fetch(request, env, context);
    const result = new Response(response.body, response);
    const pathname = new URL(request.url).pathname;
    const type = result.headers.get("content-type") ?? "";
    result.headers.set("x-content-type-options", "nosniff");
    result.headers.set("x-frame-options", "DENY");
    if (!result.headers.has("referrer-policy")) result.headers.set("referrer-policy", "same-origin");
    if (/^\/(?:auth|sign-in|sign-out|access-denied|api)(?:\/|$)/.test(pathname) ||
        /^(?:text\/html|text\/x-component)\b/i.test(type) || result.headers.has("location")) {
      result.headers.set("cache-control", noStoreHeaders["cache-control"]);
    }
    return result;
  },
};
