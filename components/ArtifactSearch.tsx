"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Artifact } from "@/lib/artifacts";
import { searchArtifacts } from "@/lib/search";

export function ArtifactSearch({ artifacts }: { artifacts: Artifact[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchArtifacts(artifacts, query), [artifacts, query]);

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title, tags, aliases, status, or body..."
          className="w-full rounded-2xl bg-slate-50 px-5 py-4 text-lg text-slate-950 outline-none ring-sky-200 transition placeholder:text-slate-400 focus:ring-4 dark:bg-slate-950 dark:text-slate-100 dark:ring-orange-500/35 dark:placeholder:text-slate-500"
        />
      </div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{results.length} artifacts found</p>
      {artifacts.length === 0 ? <p className="rounded-3xl border border-slate-200 bg-white p-6 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">The configured repository contains no compatible Markdown artifacts under its configured root.</p> : null}
      <div className="grid gap-4">
        {results.map((artifact) => (
          <Link key={artifact.id} href={`/artifacts/${artifact.id}`} className="group rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft focus:outline-none focus:ring-4 focus:ring-sky-200 dark:border-slate-800 dark:bg-slate-900 dark:focus:ring-orange-500/35">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-950 group-hover:text-sky-700 dark:text-slate-50 dark:group-hover:text-orange-300">{artifact.title}</h2>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{artifact.excerpt}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-300">{artifact.status}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800 dark:bg-orange-500/15 dark:text-orange-300">{artifact.type}</span>
              {artifact.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">#{tag}</span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
