import { Suspense } from "react";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/Ui";
import { McpServerActions } from "@/components/McpServerActions";
import { requireRepositoryAccess } from "@/lib/auth";
import { createToolDefinitionRepository, safePolicyMcp } from "@/lib/workflow-services";

export default async function Page() {
  const { access } = await requireRepositoryAccess("/tools");
  const items = createToolDefinitionRepository(access).list().then(values => Promise.all(values.map(value => safePolicyMcp(access.repositoryId, value))));
  return (
    <>
      <PageHeader title="Tools" description="Configure MCP integrations and discover their available tools." action={{ href: "/tools/new", label: "New MCP server" }} />
      <Suspense fallback={<ContentLoading label="Loading tools" cards />}>
        <AsyncContent data={items} failure="Tools could not be loaded.">
          {items => items.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {items.map(({ definition, fileSha, policyAuthority }) => (
                <article key={definition.id} className="adt-panel">
                  <h2 className="font-semibold">
                    <Link className="underline-offset-4 hover:underline" href={`/tools/${definition.id}/edit`}>{definition.name}</Link>
                  </h2>
                  <p className="text-sm text-muted-foreground">MCP · Streamable HTTP · {definition.authentication.mode === "bearer" ? "Bearer token configured" : "No authentication"}</p>
                  <p className="text-sm">{policyAuthority.verified ? "Policy authority verified" : "Policy authority unverified — administrator review required"}</p>
                  <p className="mb-3 text-sm text-muted-foreground">{definition.catalogue ? `${definition.catalogue.tools.length} tools · refreshed ${definition.catalogue.refreshedAt}` : "Not discovered"}</p>
                  {definition.catalogue?.tools.map(tool => <div key={tool.name}><strong>{tool.name}</strong>{tool.description && <span> — {tool.description}</span>}</div>)}
                  <McpServerActions id={definition.id} fileSha={fileSha} />
                </article>
              ))}
            </div>
          ) : <EmptyState title="No tool integrations yet">Add an MCP server, then discover its tools.</EmptyState>}
        </AsyncContent>
      </Suspense>
    </>
  );
}
