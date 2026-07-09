"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function VariationForm({ artifactId, defaultBody, defaultTitle }: { artifactId: string; defaultBody: string; defaultTitle: string }) {
  const router = useRouter();
  const [title, setTitle] = useState(`${defaultTitle} Variation`);
  const [body, setBody] = useState(defaultBody);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function saveVariation() {
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/artifacts/${artifactId}/variation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    setSaving(false);

    if (!response.ok) {
      setMessage("Could not save variation. Check the body and try again.");
      return;
    }

    const data = (await response.json()) as { id: string };
    setMessage("Variation saved under /artifacts/variations.");
    router.refresh();
    router.push(`/artifacts/${data.id}`);
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
      <div className="mb-4">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-sky-700">Create variation</p>
        <h2 className="text-2xl font-bold text-slate-950">Fork this artifact locally</h2>
      </div>
      <label className="mb-3 block text-sm font-semibold text-slate-700">
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-sky-500" />
      </label>
      <label className="block text-sm font-semibold text-slate-700">
        Body
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={12} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm outline-none focus:border-sky-500" />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button disabled={saving} onClick={saveVariation} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60">
          {saving ? "Saving..." : "Save as new Markdown file"}
        </button>
        {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      </div>
    </section>
  );
}
