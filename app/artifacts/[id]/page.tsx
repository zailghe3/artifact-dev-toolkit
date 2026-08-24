import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/CopyButton";
import { ProtectedArtifactShell } from "@/components/ProtectedArtifactShell";
import { VariationForm } from "@/components/VariationForm";
import { ProposalForm } from "@/components/ProposalForm";
import { CatalogueStatus } from "@/components/CatalogueStatus";
import { getArtifactWithRevision } from "@/lib/artifacts";
import { requireRepositoryAccess } from "@/lib/auth";
import { markdownToHtml } from "@/lib/markdown";
import { OperationalState } from "@/components/OperationalState";
import { artifactLifecycleLabel, isCompatibilityReadOnly } from "@/lib/artifact-presentation";
import { isExpectedOperationalError, mapOperationalError } from "@/lib/operational-errors";


export const dynamic = "force-dynamic";

export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, access } = await requireRepositoryAccess(`/artifacts/${encodeURIComponent(id)}`);
  let result; try { result = await getArtifactWithRevision(access, id); } catch (error) { if (!isExpectedOperationalError(error)) throw error; return <ProtectedArtifactShell login={session.login} currentPath={`/artifacts/${encodeURIComponent(id)}`}><OperationalState state={mapOperationalError(error)} /></ProtectedArtifactShell>; }
  if (!result) notFound();
  const { artifact, currentFileSha, catalogue } = result;
  const html = await markdownToHtml(artifact.body);
  const compatibilityReadOnly = isCompatibilityReadOnly(artifact);

  return (
    <ProtectedArtifactShell login={session.login} currentPath={`/artifacts/${encodeURIComponent(id)}`}>
      <div className="mb-4">
        <Link href="/" className="rounded-lg text-sm font-semibold text-sky-700 transition hover:text-sky-900 focus:outline-none focus:ring-4 focus:ring-sky-200 dark:text-orange-300 dark:hover:text-orange-200 dark:focus:ring-orange-500/35">← Back to artifacts</Link>
      </div>
      <CatalogueStatus refreshedAt={catalogue.refreshedAt} cacheState={catalogue.cacheState} />
      <article className="my-6 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-sky-700 dark:text-orange-300">{artifact.type}</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950 dark:text-slate-50">{artifact.title}</h1>{artifact.description ? <p className="mt-3 text-lg text-slate-600 dark:text-slate-300">{artifact.description}</p> : null}
          </div>
          <div className="flex gap-3">{!compatibilityReadOnly ? <Link href={`/artifacts/${encodeURIComponent(artifact.id)}/edit`} className="rounded-xl border px-4 py-2 font-semibold">Edit</Link> : null}<CopyButton text={artifact.body} /></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">{artifactLifecycleLabel(artifact)}</span>
          {artifact.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">#{tag}</span>)}
        </div>
        {artifact.aliases.length ? <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Aliases: {artifact.aliases.join(", ")}</p> : null}
        <div className="mt-8 max-w-none space-y-4 leading-7 text-slate-700 dark:text-slate-300 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:text-2xl [&_h2]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_strong]:text-slate-950 dark:[&_strong]:text-slate-50" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
      {compatibilityReadOnly ? <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">This compatibility artifact is read-only. You can view, search, and copy it, but lifecycle changes are unavailable.</p> : <VariationForm artifactId={artifact.id} defaultBody={artifact.body} defaultTitle={artifact.title} />}
      {!compatibilityReadOnly && artifact.status === "production" && currentFileSha ? <ProposalForm artifact={artifact} currentFileSha={currentFileSha} /> : null}
    </ProtectedArtifactShell>
  );
}
