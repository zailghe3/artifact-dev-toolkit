import { Suspense } from "react";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { PageHeader } from "@/components/Ui";
import { WorkflowDefinitionEditor } from "@/components/WorkflowDefinitionEditor";
import { requireRepositoryAccess } from "@/lib/auth";
import { reusableWorkflowAuthoringCandidates, serializeWorkflowAuthoringContext } from "@/lib/workflow-authoring-context";
import { getWorkflowAuthoringAgents } from "@/lib/workflow-authoring-support";
import { createWorkflowDefinitionRepository } from "@/lib/workflow-services";

export default async function Page() {
  const { access } = await requireRepositoryAccess("/workflows/definitions/new");
  const data = Promise.all([
    getWorkflowAuthoringAgents(access),
    createWorkflowDefinitionRepository(access).listWorkflows(),
  ]);
  return (
    <>
      <PageHeader title="New workflow" description="Arrange Agents and control blocks into a reusable Workflow." />
      <Suspense fallback={<ContentLoading label="Loading workflow editor and available blocks" />}>
        <AsyncContent data={data} failure="The Workflow editor could not load its supporting data.">
          {([agents, versions]) => {
            const workflows = versions.map(item => item.definition);
            const reusableWorkflows = reusableWorkflowAuthoringCandidates(workflows, agents);
            const authoringContext = serializeWorkflowAuthoringContext(agents, reusableWorkflows);
            return <WorkflowDefinitionEditor agents={agents} reusableWorkflows={reusableWorkflows}
              authoringContext={authoringContext} existingWorkflowIds={workflows.map(workflow => workflow.id)} />;
          }}
        </AsyncContent>
      </Suspense>
    </>
  );
}
