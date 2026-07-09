import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/CopyButton";
import { VariationForm } from "@/components/VariationForm";
import { getArtifact, getArtifacts } from "@/lib/artifacts";
import { markdownToHtml } from "@/lib/markdown";

export async function generateStaticParams() {
  const artifacts = await getArtifacts();
  return artifacts.map((artifact) => ({ id: artifact.id }));
}

export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = await getArtifact(id);
  if (!artifact) notFound();
  const html = await markdownToHtml(artifact.body);

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/" className="text-sm font-semibold text-sky-700 hover:text-sky-900">← Back to library</Link>
      <article className="my-6 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-sky-700">{artifact.type}</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">{artifact.title}</h1>
          </div>
          <CopyButton text={artifact.body} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">{artifact.status}</span>
          {artifact.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">#{tag}</span>)}
        </div>
        {artifact.aliases.length ? <p className="mt-4 text-sm text-slate-500">Aliases: {artifact.aliases.join(", ")}</p> : null}
        <div className="mt-8 max-w-none space-y-4 leading-7 text-slate-700 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:text-2xl [&_h2]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_strong]:text-slate-950" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
      <VariationForm artifactId={artifact.id} defaultBody={artifact.body} defaultTitle={artifact.title} />
    </main>
  );
}
