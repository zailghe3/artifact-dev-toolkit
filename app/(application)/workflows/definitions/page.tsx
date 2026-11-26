import { Suspense } from "react";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { DefinitionCatalogue } from "@/components/DefinitionCatalogue";
import { EmptyState, PageHeader } from "@/components/Ui";
import { requireRepositoryAccess } from "@/lib/auth";
import { createWorkflowDefinitionRepository } from "@/lib/workflow-services";

export default async function Page() {
  const { access } = await requireRepositoryAccess("/workflows/definitions");
  const items = createWorkflowDefinitionRepository(access).listWorkflows();
  return (
    <>
      <PageHeader title="Workflows" description="Create and manage reusable workflows." action={{ href: "/workflows/definitions/new", label: "New workflow" }} />
      <Suspense fallback={<ContentLoading label="Loading workflows" cards />}>
        <AsyncContent data={items} failure="Workflows could not be loaded.">
          {items => items.length ? <DefinitionCatalogue kind="workflow" items={items} /> : <EmptyState title="No workflows yet">Workflows arrange Agents and control blocks.</EmptyState>}
        </AsyncContent>
      </Suspense>
    </>
  );
}
