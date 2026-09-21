import { AppHeader } from "@/components/AppHeader";
import { ArtifactSearch } from "@/components/ArtifactSearch";
import { OperationalState } from "@/components/OperationalState";
import { getArtifactCatalogue } from "@/lib/artifacts";
import { requireRepositoryAccess } from "@/lib/auth";
import { isExpectedOperationalError, mapOperationalError } from "@/lib/operational-errors";
import Link from "next/link";
import { PageHeader } from "@/components/Ui";

export const dynamic = "force-dynamic";

function CatalogueWarning({ cacheState }: { cacheState: "fresh" | "refreshed" | "stale" | "degraded" }) {
  if (cacheState === "stale") return <p role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200">Catalogue data may be stale. <Link href="/diagnostics" className="underline decoration-2 underline-offset-4">View Diagnostics</Link></p>;
  if (cacheState === "degraded") return <p role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200">Catalogue caching is temporarily unavailable. <Link href="/diagnostics" className="underline decoration-2 underline-offset-4">View Diagnostics</Link></p>;
  return null;
}

export default async function Home() {
  const { session, access } = await requireRepositoryAccess("/");
  let catalogue; try { catalogue = await getArtifactCatalogue(access); } catch (error) { if (!isExpectedOperationalError(error)) throw error; return <><AppHeader login={session.login} currentPath="/" /><main className="mx-auto min-h-screen max-w-5xl px-4 py-8"><OperationalState state={mapOperationalError(error)} /></main></>; }
  const artifacts = catalogue.artifacts;

  return (
    <>
      <AppHeader login={session.login} currentPath="/" />
      <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader title="Artifacts" meta={`${artifacts.length} artifacts`} action={{href:"/artifacts/new",label:"New artifact"}} />
        <CatalogueWarning cacheState={catalogue.cacheState} />
        <ArtifactSearch artifacts={artifacts} />
      </main>
    </>
  );
}
