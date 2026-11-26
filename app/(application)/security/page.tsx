import { Suspense } from "react";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/Ui";
import { requireRepositoryAccess } from "@/lib/auth";
import { listSafeSecurityProfiles } from "@/lib/workflow-services";

export default async function Page() {
  const { access } = await requireRepositoryAccess("/security");
  const items = listSafeSecurityProfiles(access);
  return (
    <>
      <PageHeader title="Security" description="Configure Adrian identities and automated enforcement for supported Agents." action={{ href: "/security/new", label: "New Security Profile" }} />
      <Suspense fallback={<ContentLoading label="Loading security" cards />}>
        <AsyncContent data={items} failure="Security could not be loaded.">
          {items => items.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {items.map(({ definition }) => (
                <article className="adt-panel" key={definition.id}>
                  <h2 className="font-semibold"><Link className="underline-offset-4 hover:underline" href={`/security/${definition.id}`}>{definition.name}</Link></h2>
                  <p className="mt-1 text-sm">{definition.description}</p>
                  <p className="mt-2 text-sm text-muted-foreground">Adrian · {definition.credentialConfigured ? "Credential configured" : "Credential unavailable"}</p>
                </article>
              ))}
            </div>
          ) : <EmptyState title="No Security Profiles">Create a profile to add optional Adrian enforcement to supported Agents.</EmptyState>}
        </AsyncContent>
      </Suspense>
    </>
  );
}
