"use client";

import { useState } from "react";
import type { Artifact } from "@/lib/artifact-repository";
import { hasPreview, proposalErrorMessage, safeGitHubUrl, unknownEditErrorMessage } from "@/lib/edit-ui";

export function ProposalForm({ artifact, currentFileSha }: { artifact: Artifact; currentFileSha: string }) {
  const [title, setTitle] = useState(artifact.title); const [body, setBody] = useState(artifact.body);
  const [tags, setTags] = useState(artifact.tags.join(", ")); const [aliases, setAliases] = useState(artifact.aliases.join(", "));
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [preview, setPreview] = useState<unknown>(); const [pullUrl, setPullUrl] = useState<string>(); const [recoveryUrl, setRecoveryUrl] = useState<string>();
  const metadata = () => ({ id: artifact.id, title, type: artifact.type, status: artifact.status, tags: tags.split(",").map((v) => v.trim()).filter(Boolean), aliases: aliases.split(",").map((v) => v.trim()).filter(Boolean), ...(artifact.sourceId ? { sourceId: artifact.sourceId } : {}), ...(artifact.createdAt ? { createdAt: artifact.createdAt } : {}) });
  async function request(endpoint: "preview" | "") {
    if (busy) return; setBusy(true); setMessage(""); setRecoveryUrl(undefined);
    try {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(artifact.id)}/proposal${endpoint ? "/preview" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metadata: metadata(), body, currentFileSha }) });
      let data: unknown; try { data = await response.json(); } catch { data = undefined; }
      if (!response.ok) { const code = (data as { code?: unknown } | undefined)?.code; setMessage(proposalErrorMessage(code)); if (code === "proposal_incomplete") setRecoveryUrl(safeGitHubUrl((data as { branchUrl?: unknown }).branchUrl, "branch")); return; }
      if (endpoint === "preview") { if (hasPreview(data)) setPreview(data); else setMessage(unknownEditErrorMessage); return; }
      const url = safeGitHubUrl((data as { pullRequestUrl?: unknown } | undefined)?.pullRequestUrl, "pull");
      if (response.status !== 201 || !url) { setMessage(unknownEditErrorMessage); return; } setPullUrl(url);
    } catch { setMessage(unknownEditErrorMessage); } finally { setBusy(false); }
  }
  return <section className="mt-6 rounded-3xl border border-amber-300 bg-white p-5 shadow-soft dark:border-amber-700 dark:bg-slate-900">
    <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700 dark:text-amber-300">Propose production change</p><h2 className="text-2xl font-bold">Open a GitHub pull request</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">This creates a reviewable branch and pull request. The live artifact does not change until that pull request is merged; Artifact Library will not merge it automatically.</p>
    <label className="mt-4 block text-sm font-semibold">Title<input className="mt-1 w-full rounded-xl border p-2 dark:bg-slate-950" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label className="mt-3 block text-sm font-semibold">Tags (comma-separated)<input className="mt-1 w-full rounded-xl border p-2 dark:bg-slate-950" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
    <label className="mt-3 block text-sm font-semibold">Aliases (comma-separated)<input className="mt-1 w-full rounded-xl border p-2 dark:bg-slate-950" value={aliases} onChange={(e) => setAliases(e.target.value)} /></label>
    <label className="mt-3 block text-sm font-semibold">Body<textarea rows={12} className="mt-1 w-full rounded-xl border p-2 font-mono text-sm dark:bg-slate-950" value={body} onChange={(e) => setBody(e.target.value)} /></label>
    <div className="mt-4 flex gap-3"><button disabled={busy} onClick={() => request("preview")} className="rounded-xl border border-amber-600 px-4 py-2 font-semibold">Preview</button><button disabled={busy} onClick={() => request("")} className="rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white">{busy ? "Working..." : "Create pull request"}</button></div>
    {message ? <p className="mt-3 text-sm">{message}</p> : null}{recoveryUrl ? <a href={recoveryUrl} className="underline">View proposal branch</a> : null}{pullUrl ? <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-emerald-900"><strong>Proposal created.</strong> The live artifact is unchanged. <a className="underline" href={pullUrl} target="_blank" rel="noreferrer">View GitHub pull request</a></p> : null}
    {hasPreview(preview) ? <article className="mt-5 rounded-xl border p-4"><h3 className="text-xl font-bold">{preview.metadata.title}</h3><p className="text-sm">Status: {preview.metadata.status} · Tags: {preview.metadata.tags.join(", ") || "None"} · Aliases: {preview.metadata.aliases.join(", ") || "None"}</p><div className="mt-3" dangerouslySetInnerHTML={{ __html: preview.bodyHtml }} /></article> : null}
  </section>;
}
