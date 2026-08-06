"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogueRefreshAvailability } from "@/lib/diagnostics-model";

const guidance: Record<Exclude<CatalogueRefreshAvailability, { available: true }>["reason"], string> = {
  local_backend: "Manual catalogue refresh is not used by the local file backend.",
  cache_binding_missing: "Configure the catalogue cache binding before refreshing.",
  repository_identity_missing: "Repository details are unavailable. Reauthorize repository access before refreshing.",
  installation_identity_missing: "Repository installation details are unavailable. Reauthorize repository access before refreshing.",
  authorization_unavailable: "Restore repository authorization before refreshing the catalogue.",
  authentication_unavailable: "Repository read access could not be verified. Resolve the authentication problem before refreshing.",
  read_permission_missing: "Restore repository read access before refreshing the catalogue.",
  read_permission_unverified: "Repository read access could not be verified. Reauthorize repository access before refreshing.",
  configuration_invalid: "Correct the GitHub App configuration before refreshing the catalogue.",
};

const apiErrorMessages: Record<string, string> = {
  refresh_unsupported: "Manual catalogue refresh is not supported for the current repository backend.",
  repository_access_denied: "Repository access was denied. Restore repository read access before refreshing the catalogue.",
  repository_unavailable: "The artifact repository is temporarily unavailable. Try refreshing again later.",
  refresh_failed: "Refresh failed. The current catalogue was not replaced.",
};

async function safeRefreshMessage(response: Response) {
  try {
    const body = await response.json() as { code?: unknown };
    if (typeof body.code === "string") return apiErrorMessages[body.code] ?? apiErrorMessages.refresh_failed;
  } catch { /* ignore malformed API responses */ }
  return apiErrorMessages.refresh_failed;
}

function AvailableCatalogueRefreshControls() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function refresh(full = false) {
    if (pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/artifacts/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ full }) });
      if (!response.ok) { setError(await safeRefreshMessage(response)); return; }
      router.refresh();
    } catch { setError(apiErrorMessages.refresh_failed); }
    finally { setPending(false); }
  }
  return <div className="space-y-2"><div className="flex flex-wrap gap-2"><button disabled={pending} onClick={() => refresh()} className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Refreshing…" : "Refresh"}</button><button disabled={pending} onClick={() => refresh(true)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">Full rebuild</button></div>{error ? <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">{error}</p> : null}</div>;
}

export function CatalogueRefreshControls({ availability }: { availability: CatalogueRefreshAvailability }) {
  if (!availability.available) return <p className="rounded-xl bg-slate-100 p-3 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{guidance[availability.reason]}</p>;
  return <AvailableCatalogueRefreshControls />;
}
