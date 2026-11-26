import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { PageHeader } from "@/components/Ui";
import { WorkflowDefinitionEditor } from "@/components/WorkflowDefinitionEditor";
import { requireRepositoryAccess } from "@/lib/auth";
import { getWorkflowAuthoringAgents } from "@/lib/workflow-authoring-support";
import { workflowDefinitionPath } from "@/lib/workflow-definitions";
import { createWorkflowDefinitionRepository, createWorkflowLayoutRepository } from "@/lib/workflow-services";

export default async function Page({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;
  const { access } = await requireRepositoryAccess(`/workflows/definitions/${workflowId}/edit`);
  workflowDefinitionPath(workflowId);
  const workflows = await createWorkflowDefinitionRepository(access).listWorkflows();
  const value = workflows.find(item => item.definition.id === workflowId);
  if (!value) notFound();

  const reusable = workflows.map(item => item.definition)
    .filter(item => item.schemaVersion === 2 && item.exposableAsBlock && item.id !== workflowId)
    .map(({ id, name, description }) => ({ id, name, description }));
  const data = Promise.all([
    getWorkflowAuthoringAgents(access),
    createWorkflowLayoutRepository(access).getLayout(workflowId),
  ]);

  return (
    <>
      <PageHeader title={`Edit ${value.definition.name}`} description="Update Workflow semantics and presentation layout." />
      <Suspense fallback={<ContentLoading label="Loading workflow editor and layout" />}>
        <AsyncContent data={data} failure="The Workflow editor could not load its supporting data.">
          {([agents, layout]) => <WorkflowDefinitionEditor agents={agents} reusableWorkflows={reusable}
            initial={value.definition} fileSha={value.fileSha} initialLayout={layout} />}
        </AsyncContent>
      </Suspense>
    </>
  );
}
