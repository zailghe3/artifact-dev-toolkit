"use client";

import { useState } from "react";
import {PendingButtonContent} from "@/components/PendingButtonContent";
import { unknownVariationErrorMessage, variationErrorMessage } from "@/lib/variation-errors";
import { hasPreview, safeGitHubUrl } from "@/lib/edit-ui";
import {FormActions,Panel,buttonStyles} from "@/components/Ui";

export function VariationForm({ artifactId, defaultBody, defaultTitle }: { artifactId: string; defaultBody: string; defaultTitle: string }) {
  const [title, setTitle] = useState(`${defaultTitle} Variation`);
  const [body, setBody] = useState(defaultBody);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<unknown>();
  const [success, setSuccess] = useState<{ artifactUrl: string; commitUrl: string }>();

  async function previewVariation() {
    setMessage(""); setPreview(undefined);
    try {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/variation/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body }) });
      const data: unknown = await response.json();
      if (!response.ok || !hasPreview(data)) { setMessage(variationErrorMessage((data as { code?: unknown } | undefined)?.code)); return; }
      setPreview(data);
    } catch { setMessage(unknownVariationErrorMessage); }
  }

  async function saveVariation() {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/artifacts/${artifactId}/variation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      let data: unknown;
      try { data = await response.json(); } catch { data = undefined; }
      if (!response.ok) {
        setMessage(variationErrorMessage((data as { code?: unknown } | undefined)?.code));
        return;
      }
      const id = (data as { id?: unknown } | undefined)?.id;
      const commitUrl = safeGitHubUrl((data as { commitUrl?: unknown } | undefined)?.commitUrl, "commit");
      if (response.status !== 201 || typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !commitUrl) {
        setMessage(unknownVariationErrorMessage);
        return;
      }
      setSuccess({ artifactUrl: `/artifacts/${encodeURIComponent(id)}`, commitUrl });
    } catch {
      setMessage(unknownVariationErrorMessage);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel>
      <div className="mb-4">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-sky-700 dark:text-orange-300">Create variation</p>
        <h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Create a variation</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Save a direct commit to the private artifact repository.</p>
      </div>
      <label className="mb-3 block text-sm font-semibold text-slate-700 dark:text-slate-200">
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} className="adt-field mt-1" />
      </label>
      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
        Body
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={12} className="adt-field mt-1 font-mono text-sm" />
      </label>
      <div className="mt-4"><FormActions feedback={message ? <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p> : null}>
        <button disabled={saving} onClick={previewVariation} className={buttonStyles.secondary}>Preview</button>
        <button disabled={saving} aria-busy={saving} onClick={saveVariation} className={buttonStyles.primary}>
          <PendingButtonContent pending={saving}>{saving ? "Saving…" : "Save variation"}</PendingButtonContent>
        </button>
      </FormActions></div>
      {success ? <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"><strong>Variation saved</strong><div className="mt-2 flex gap-4"><a className="underline" href={success.artifactUrl}>View variation</a><a className="underline" href={success.commitUrl} target="_blank" rel="noreferrer">View GitHub commit</a></div></div> : null}
      {hasPreview(preview) ? <article className="mt-5 rounded-2xl border border-slate-200 p-5 dark:border-slate-700"><h3 className="text-xl font-bold">{preview.metadata.title}</h3><dl className="my-3 text-sm"><dt className="font-semibold">Source</dt><dd>{preview.metadata.sourceId}</dd><dt className="font-semibold">Tags</dt><dd>{preview.metadata.tags.join(", ") || "None"}</dd><dt className="font-semibold">Aliases</dt><dd>{preview.metadata.aliases.join(", ") || "None"}</dd></dl><div className="prose" dangerouslySetInnerHTML={{ __html: preview.bodyHtml }} /></article> : null}
    </Panel>
  );
}
