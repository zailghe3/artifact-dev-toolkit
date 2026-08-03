export type PermissionReason = "granted" | "permission_missing" | "installation_missing" | "authentication_failed" | "temporarily_unavailable" | "rate_limited" | "malformed_response" | "prerequisite_invalid" | "not_checked";
export type PermissionCheck = { effective: boolean | "unknown"; reason: PermissionReason };
export const unknownPermissionCheck = (reason: PermissionReason = "not_checked"): PermissionCheck => ({ effective: "unknown", reason });

export function classifyCapabilityResult(result: PromiseSettledResult<{ permissions?: Record<string, string> }>, required: Array<[string, string[]]>): PermissionCheck {
  if (result.status === "rejected") {
    const status = (result.reason as { status?: number }).status;
    if (status === 401) return unknownPermissionCheck("authentication_failed");
    if (status === 403 || status === 404) return { effective: false, reason: "installation_missing" };
    if (status === 429) return unknownPermissionCheck("rate_limited");
    if (typeof status === "number" && status >= 500) return unknownPermissionCheck("temporarily_unavailable");
    return unknownPermissionCheck("malformed_response");
  }
  const permissions = result.value.permissions;
  if (!permissions || typeof permissions !== "object") return unknownPermissionCheck("malformed_response");
  const granted = required.every(([name, levels]) => levels.includes(permissions[name] ?? ""));
  return { effective: granted, reason: granted ? "granted" : "permission_missing" };
}
