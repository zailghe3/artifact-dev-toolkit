import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtifactEditor } from "@/components/ArtifactEditor";
import { OperationalState } from "@/components/OperationalState";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { requireRepositoryAccess } from "@/lib/auth";
import { getArtifactWithRevision } from "@/lib/artifacts";
import { isExpectedOperationalError, mapOperationalError } from "@/lib/operational-errors";
export const dynamic = "force-dynamic";
export default async function EditArtifactPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; const { access, session } = await requireRepositoryAccess(`/artifacts/${encodeURIComponent(id)}/edit`); let result; try { result = await getArtifactWithRevision(access, id); } catch (error) { if (!isExpectedOperationalError(error)) throw error; return <main className="mx-auto min-h-screen max-w-4xl px-4 py-8"><OperationalState state={mapOperationalError(error)} /></main>; } if (!result) notFound(); return <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6"><div className="mb-5 flex items-center justify-between gap-4"><Link href={`/artifacts/${encodeURIComponent(id)}`} className="font-semibold text-sky-700 dark:text-orange-300">← Back to artifact</Link><div className="flex items-center gap-4"><SignOutButton login={session.login} /><ThemeToggle /></div></div><ArtifactEditor artifact={result.artifact} currentFileSha={result.currentFileSha} /></main>; }
