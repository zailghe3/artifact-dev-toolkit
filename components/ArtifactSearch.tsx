"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Artifact } from "@/lib/artifacts";
import { searchArtifacts } from "@/lib/search";
import { ArtifactDeleteButton } from "@/components/ArtifactDeleteButton";
import { CopyButton } from "@/components/CopyButton";
import { reconcileTombstones, tombstonesAfterResult, visibleArtifacts, type DeletionResult } from "@/lib/deletion-ui";

export function catalogueCopyText(artifact: Pick<Artifact, "body">) { return artifact.body; }

export function ArtifactSearch({ artifacts }: { artifacts: Artifact[] }) {
  const [query, setQuery] = useState("");
  const router = useRouter();
  const [previousArtifacts, setPreviousArtifacts] = useState(artifacts);
  const [tombstones, setTombstones] = useState<Set<string>>(() => new Set());
  const [operationResult, setOperationResult] = useState<DeletionResult>();
  const currentArtifacts = useMemo(() => visibleArtifacts(artifacts, tombstones), [artifacts, tombstones]);
  const results = useMemo(() => searchArtifacts(currentArtifacts, query), [currentArtifacts, query]);
  if (previousArtifacts !== artifacts) { setPreviousArtifacts(artifacts); setTombstones((current) => reconcileTombstones(artifacts, current)); }
  function handleDeletion(result: DeletionResult) { setOperationResult(result); setTombstones((current) => tombstonesAfterResult(current, result)); if (result.kind === "deleted") router.refresh(); }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title, description, type, tags, aliases, or body..."
          className="w-full rounded-2xl bg-slate-50 px-5 py-4 text-lg text-slate-950 outline-none ring-sky-200 transition placeholder:text-slate-400 focus:ring-4 dark:bg-slate-950 dark:text-slate-100 dark:ring-orange-500/35 dark:placeholder:text-slate-500"
        />
      </div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{results.length} artifacts found</p>
      {currentArtifacts.length === 0 ? <p className="rounded-3xl border border-slate-200 bg-white p-6 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">The configured repository contains no compatible Markdown artifacts under its configured root.</p> : null}
      {operationResult ? <p className="rounded-xl bg-emerald-50 p-4 text-emerald-950">Deleted <strong>{operationResult.artifactId}</strong>. <a className="underline" href={operationResult.commitUrl} target="_blank" rel="noreferrer">View commit</a></p> : null}
      <div className="grid gap-4">
        {results.map((artifact) => (
          <article key={artifact.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><Link href={`/artifacts/${artifact.id}`} className="group block transition hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-sky-200 dark:focus:ring-orange-500/35">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-950 group-hover:text-sky-700 dark:text-slate-50 dark:group-hover:text-orange-300">{artifact.title}</h2>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{artifact.description || artifact.excerpt}</p>
              </div>

            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800 dark:bg-orange-500/15 dark:text-orange-300">{artifact.type}</span>
              {artifact.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">#{tag}</span>
              ))}
            </div>
          </Link><div className="mt-4 flex flex-wrap items-center border-t border-slate-200 pt-3 dark:border-slate-800"><ArtifactDeleteButton artifact={artifact} onResult={handleDeletion} onStart={() => setOperationResult(undefined)} /><span className="ml-auto"><CopyButton text={catalogueCopyText(artifact)} compact label={`${artifact.title} body`} /></span></div></article>
        ))}
      </div>
    </div>
  );
}
