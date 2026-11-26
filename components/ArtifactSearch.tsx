"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { Artifact } from "@/lib/artifacts";
import { searchArtifacts } from "@/lib/search";
import { ArtifactDeleteButton } from "@/components/ArtifactDeleteButton";
import { CopyButton } from "@/components/CopyButton";
import { reconcileTombstones, tombstonesAfterResult, visibleArtifacts, type DeletionResult } from "@/lib/deletion-ui";
import { EmptyState, EntityActions, EntityCard } from "@/components/Ui";

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input type="search" aria-label="Search artifacts" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Search artifacts" className="adt-field pl-9" />
        </div>
        <p role="status" className="text-sm text-muted-foreground">{results.length} {results.length === 1 ? "artifact" : "artifacts"} found</p>
      </div>
      {currentArtifacts.length > 0 && results.length === 0 && <EmptyState title="No matching artifacts">Try a different search term.</EmptyState>}
      {currentArtifacts.length === 0 ? <EmptyState title="No artifacts yet">The configured repository contains no compatible Markdown artifacts under its configured root.</EmptyState> : null}
      {operationResult ? <p className="rounded-xl bg-emerald-50 p-4 text-emerald-950">Deleted <strong>{operationResult.artifactId}</strong>. <a className="underline" href={operationResult.commitUrl} target="_blank" rel="noreferrer">View commit</a></p> : null}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {results.map((artifact) => (
          <EntityCard key={artifact.id} href={`/artifacts/${artifact.id}`} label={`Open artifact ${artifact.title}`} actions={<EntityActions danger={<ArtifactDeleteButton artifact={artifact} onResult={handleDeletion} onStart={() => setOperationResult(undefined)} />}><CopyButton text={catalogueCopyText(artifact)} compact label={`${artifact.title} body`} /></EntityActions>}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground group-hover:text-primary">{artifact.title}</h2>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{artifact.description || artifact.excerpt}</p>
              </div>

            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">{artifact.type}</span>
              {artifact.tags.map((tag) => (
                <span key={tag} className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">#{tag}</span>
              ))}
            </div>
          </EntityCard>
        ))}
      </div>
    </div>
  );
}
