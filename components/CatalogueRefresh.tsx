"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CatalogueRefresh({ refreshedAt, cacheState }: { refreshedAt: string; cacheState: "fresh" | "refreshed" | "stale" }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function refresh(full = false) {
    if (pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/artifacts/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ full }) });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch { setError("Refresh failed. The current catalogue was not replaced."); }
    finally { setPending(false); }
  }
  return <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p><strong className="capitalize">{cacheState}</strong> · Last successful refresh <time dateTime={refreshedAt}>{new Date(refreshedAt).toLocaleString()}</time></p>
      <div className="flex gap-2"><button disabled={pending} onClick={() => refresh()} className="rounded-lg bg-sky-700 px-3 py-2 font-semibold text-white disabled:opacity-50">{pending ? "Refreshing…" : "Refresh"}</button><button disabled={pending} onClick={() => refresh(true)} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold disabled:opacity-50">Full rebuild</button></div>
    </div>
    {cacheState === "stale" ? <p role="alert" className="mt-2 font-semibold text-amber-700 dark:text-amber-300">GitHub is temporarily unavailable. Stale catalogue content is being served.</p> : null}
    {error ? <p role="alert" className="mt-2 text-red-700">{error}</p> : null}
  </div>;
}
