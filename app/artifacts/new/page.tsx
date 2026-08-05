import Link from "next/link";
import { ArtifactEditor } from "@/components/ArtifactEditor";
import { AppHeader } from "@/components/AppHeader";
import { getTagSuggestions } from "@/lib/artifacts";
import type { TagSuggestion } from "@/lib/tag-suggestions";
import { isExpectedOperationalError } from "@/lib/operational-errors";
import { requireRepositoryAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";
export default async function NewArtifactPage() {
  const { access, session } = await requireRepositoryAccess("/artifacts/new");
  let tagSuggestions: TagSuggestion[] = []; let tagSuggestionsUnavailable = false;
  try { tagSuggestions = await getTagSuggestions(access); }
  catch (error) { if (!isExpectedOperationalError(error)) throw error; tagSuggestionsUnavailable = true; }
  return <><AppHeader login={session.login} currentPath="/artifacts/new" /><main className="mx-auto min-h-screen max-w-4xl px-4 py-6 sm:px-6"><div className="mb-5"><Link href="/" className="font-semibold text-sky-700 dark:text-orange-300">← Back to artifacts</Link></div><ArtifactEditor tagSuggestions={tagSuggestions} tagSuggestionsUnavailable={tagSuggestionsUnavailable} /></main></>;
}
