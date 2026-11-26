import { Suspense } from "react";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { DefinitionCatalogue } from "@/components/DefinitionCatalogue";
import { EmptyState, PageHeader } from "@/components/Ui";
import { requireRepositoryAccess } from "@/lib/auth";
import { createWorkflowDefinitionRepository } from "@/lib/workflow-services";

export default async function Page() {
  const { access } = await requireRepositoryAccess("/workflows/agents");
  const items = createWorkflowDefinitionRepository(access).listAgents();
  return (
    <>
      <PageHeader title="Agents" description="Configure reusable Agents and their provider connections." action={{ href: "/workflows/agents/new", label: "New agent" }} />
      <Suspense fallback={<ContentLoading label="Loading agents" cards />}>
        <AsyncContent data={items} failure="Agents could not be loaded.">
          {items => items.length ? <DefinitionCatalogue kind="agent" items={items} /> : <EmptyState title="No agents yet">Agents provide instructions and provider connections for Workflow blocks.</EmptyState>}
        </AsyncContent>
      </Suspense>
    </>
  );
}
