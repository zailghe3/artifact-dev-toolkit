import { Suspense } from "react";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { EmptyState, PageHeader } from "@/components/Ui";
import { WorkflowRunsTable } from "@/components/WorkflowRunsTable";
import { requireRepositoryAccess } from "@/lib/auth";
import { workflowRunName } from "@/lib/workflow-run-presentation";
import { WorkflowServiceUnavailable } from "@/components/WorkflowServiceUnavailable";
import { WORKFLOW_HISTORY_LIMIT } from "@/lib/runtime-service-client";
import { readWorkflowRunHistory } from "@/lib/workflow-services";

export default async function Page() {
  const { access } = await requireRepositoryAccess("/workflows/runs");
  const history = readWorkflowRunHistory(access.repositoryId, WORKFLOW_HISTORY_LIMIT);
  return (
    <>
      <PageHeader title="Workflow runs" description="Review current and completed Workflow executions." />
      <Suspense fallback={<ContentLoading label="Loading Workflow runs" />}>
        <AsyncContent data={history} failure="Workflow runs could not be loaded.">
          {history => history.status === "unavailable" ? <WorkflowServiceUnavailable retryPath="/workflows/runs" />
            : history.runs.length ? <WorkflowRunsTable runs={history.runs.map(run => ({
            id: run.id, workflowName: workflowRunName(run), status: run.status, createdAt: run.createdAt,
            startedAt: run.startedAt, completedAt: run.completedAt, currentStepId: run.currentStepId,
          }))} /> : <EmptyState title="No workflow runs yet">Runs appear here after a Workflow is started.</EmptyState>}
        </AsyncContent>
      </Suspense>
    </>
  );
}
