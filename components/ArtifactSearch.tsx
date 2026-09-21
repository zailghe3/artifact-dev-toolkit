"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Artifact } from "@/lib/artifacts";
import { searchArtifacts } from "@/lib/search";
import { ArtifactDeleteButton } from "@/components/ArtifactDeleteButton";
import { CopyButton } from "@/components/CopyButton";
import { reconcileTombstones, tombstonesAfterResult, visibleArtifacts, type DeletionResult } from "@/lib/deletion-ui";
import { EmptyState, EntityActions, EntityCard, Panel } from "@/components/Ui";

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
      <Panel aria-label="Search artifacts">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title, description, type, tags, aliases, or body..."
          className="adt-field"
        />
      </Panel>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{results.length} artifacts found</p>
      {currentArtifacts.length === 0 ? <EmptyState title="No artifacts yet">The configured repository contains no compatible Markdown artifacts under its configured root.</EmptyState> : null}
      {operationResult ? <p className="rounded-xl bg-emerald-50 p-4 text-emerald-950">Deleted <strong>{operationResult.artifactId}</strong>. <a className="underline" href={operationResult.commitUrl} target="_blank" rel="noreferrer">View commit</a></p> : null}
      <div className="grid gap-4">
        {results.map((artifact) => (
          <EntityCard key={artifact.id} href={`/artifacts/${artifact.id}`} label={`Open artifact ${artifact.title}`} actions={<EntityActions danger={<ArtifactDeleteButton artifact={artifact} onResult={handleDeletion} onStart={() => setOperationResult(undefined)} />}><CopyButton text={catalogueCopyText(artifact)} compact label={`${artifact.title} body`} /></EntityActions>}>
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
          </EntityCard>
        ))}
      </div>
    </div>
  );
}
