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
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-sky-700 dark:text-orange-300">Create variation</p>
        <h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Fork this artifact locally</h2>
      </div>
      <label className="mb-3 block text-sm font-semibold text-slate-700 dark:text-slate-200">
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-950 outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-orange-400 dark:focus:ring-orange-500/35" />
      </label>
      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
        Body
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={12} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-orange-400 dark:focus:ring-orange-500/35" />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button disabled={saving} onClick={saveVariation} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus:outline-none focus:ring-4 focus:ring-sky-200 disabled:opacity-60 dark:bg-orange-500 dark:text-slate-950 dark:hover:bg-orange-400 dark:focus:ring-orange-500/35">
          {saving ? "Saving..." : "Save as new Markdown file"}
        </button>
        {message ? <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p> : null}
      </div>
    </section>
  );
}
