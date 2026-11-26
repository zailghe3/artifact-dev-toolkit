import { Suspense } from "react";
import Link from "next/link";
import { ArtifactEditor } from "@/components/ArtifactEditor";
import { ContentLoading } from "@/components/ContentLoading";
import { PageHeader } from "@/components/Ui";
import { getTagSuggestions } from "@/lib/artifacts";
import { requireRepositoryAccess } from "@/lib/auth";
import { isExpectedOperationalError } from "@/lib/operational-errors";
import type { RepositoryAccessContext } from "@/lib/repository-authorization";

export const dynamic = "force-dynamic";

async function NewArtifactEditor({ access }: { access: RepositoryAccessContext }) {
  let tagSuggestions;
  try {
    tagSuggestions = await getTagSuggestions(access);
  } catch (error) {
    if (!isExpectedOperationalError(error)) throw error;
  }
  return <ArtifactEditor tagSuggestions={tagSuggestions} tagSuggestionsUnavailable={!tagSuggestions} />;
}

export default async function NewArtifactPage() {
  const { access } = await requireRepositoryAccess("/artifacts/new");
  return (
    <div className="max-w-4xl">
      <Link href="/" className="mb-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">← Back to artifacts</Link>
      <PageHeader title="New artifact" description="Create a reusable Artifact in the configured repository." />
      <Suspense fallback={<ContentLoading label="Loading artifact editor and tag suggestions" />}>
        <NewArtifactEditor access={access} />
      </Suspense>
    </div>
  );
}
