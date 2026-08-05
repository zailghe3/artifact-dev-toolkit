import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtifactEditor } from "@/components/ArtifactEditor";
import { OperationalState } from "@/components/OperationalState";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getArtifactWithRevision, getTagSuggestions } from "@/lib/artifacts";
import { isExpectedOperationalError, mapOperationalError } from "@/lib/operational-errors";
import { requireRepositoryAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";
export default async function EditArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { access, session } = await requireRepositoryAccess(`/artifacts/${encodeURIComponent(id)}/edit`);
  const [artifactRead, suggestionRead] = await Promise.allSettled([getArtifactWithRevision(access, id), getTagSuggestions(access)]);
  if (artifactRead.status === "rejected") { if (!isExpectedOperationalError(artifactRead.reason)) throw artifactRead.reason; return <main className="mx-auto min-h-screen max-w-4xl px-4 py-8"><OperationalState state={mapOperationalError(artifactRead.reason)} /></main>; }
  if (!artifactRead.value) notFound();
  if (suggestionRead.status === "rejected" && !isExpectedOperationalError(suggestionRead.reason)) throw suggestionRead.reason;
  const result = artifactRead.value; const tagSuggestions = suggestionRead.status === "fulfilled" ? suggestionRead.value : []; const tagSuggestionsUnavailable = suggestionRead.status === "rejected";
  return <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6"><div className="mb-5 flex items-center justify-between gap-4"><Link href={`/artifacts/${encodeURIComponent(id)}`} className="font-semibold text-sky-700 dark:text-orange-300">← Back to artifact</Link><div className="flex items-center gap-4"><SignOutButton login={session.login} /><ThemeToggle /></div></div><ArtifactEditor artifact={result.artifact} currentFileSha={result.currentFileSha} tagSuggestions={tagSuggestions} tagSuggestionsUnavailable={tagSuggestionsUnavailable} /></main>;
}
