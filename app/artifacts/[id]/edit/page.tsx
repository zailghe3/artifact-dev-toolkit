import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtifactEditor } from "@/components/ArtifactEditor";
import { requireRepositoryAccess } from "@/lib/auth";
import { getArtifactWithRevision } from "@/lib/artifacts";
export const dynamic = "force-dynamic";
export default async function EditArtifactPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; const { access } = await requireRepositoryAccess(`/artifacts/${encodeURIComponent(id)}/edit`); const result = await getArtifactWithRevision(access, id); if (!result) notFound(); return <main className="mx-auto min-h-screen max-w-4xl px-4 py-8"><Link href={`/artifacts/${encodeURIComponent(id)}`} className="mb-5 inline-block font-semibold text-sky-700">← Back to artifact</Link><ArtifactEditor artifact={result.artifact} currentFileSha={result.currentFileSha} /></main>; }
