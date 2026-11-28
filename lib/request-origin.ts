import { noStoreHeaders } from "./auth-core.ts";

const browserMutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function browserMutationRejection(request: Request, format: "json" | "form" = "json"): Response | undefined {
  if (!browserMutationMethods.has(request.method)) return;

  const origin = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.headers.get("origin") !== origin || (fetchSite !== null && fetchSite !== "same-origin")) {
    return Response.json({ code: "invalid_origin", error: "Request origin is invalid." }, { status: 403, headers: noStoreHeaders });
  }
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (format === "json" && request.body !== null && type !== "application/json") {
    return Response.json({ code: "unsupported_media_type", error: "Use Content-Type: application/json." }, { status: 415, headers: noStoreHeaders });
  }
}
