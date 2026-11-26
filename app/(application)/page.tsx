import { Suspense } from "react";
import Link from "next/link";
import { ArtifactSearch } from "@/components/ArtifactSearch";
import { ContentLoading } from "@/components/ContentLoading";
import { OperationalState } from "@/components/OperationalState";
import { PageHeader } from "@/components/Ui";
import { getArtifactCatalogue } from "@/lib/artifacts";
import { requireRepositoryAccess } from "@/lib/auth";
import { isExpectedOperationalError, mapOperationalError } from "@/lib/operational-errors";

export const dynamic = "force-dynamic";

async function Catalogue({ data }: { data: ReturnType<typeof getArtifactCatalogue> }) {
  let catalogue;
  try {
    catalogue = await data;
  } catch (error) {
    if (!isExpectedOperationalError(error)) throw error;
    return <OperationalState state={mapOperationalError(error)} />;
  }
  const warning = catalogue.cacheState === "stale" ? "Catalogue data may be stale."
    : catalogue.cacheState === "degraded" ? "Catalogue caching is temporarily unavailable." : null;
  return (
    <>
      {warning && (
        <p role={catalogue.cacheState === "stale" ? "alert" : "status"} className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200">
          {warning} <Link href="/diagnostics" className="underline underline-offset-4">View Diagnostics</Link>
        </p>
      )}
      <ArtifactSearch artifacts={catalogue.artifacts} />
    </>
  );
}

export default async function Home() {
  const { access } = await requireRepositoryAccess("/");
  const catalogue = getArtifactCatalogue(access);
  return (
    <>
      <PageHeader title="Artifacts" description="Search and manage reusable prompts, templates, snippets, and other work assets."
        action={{ href: "/artifacts/new", label: "New artifact" }} />
      <Suspense fallback={<ContentLoading label="Loading artifact catalogue" rows={4} cards />}>
        <Catalogue data={catalogue} />
      </Suspense>
    </>
  );
}
