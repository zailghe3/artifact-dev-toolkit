import { requireRepositoryAccess } from "@/lib/auth";
import { workflowRunName } from "@/lib/workflow-run-presentation";
import { EmptyState, PageHeader } from "@/components/Ui";
import { WorkflowRunsTable } from "@/components/WorkflowRunsTable";
import { WorkflowServiceUnavailable } from "@/components/WorkflowServiceUnavailable";
import { WORKFLOW_HISTORY_LIMIT } from "@/lib/runtime-service-client";
import { readWorkflowRunHistory } from "@/lib/workflow-services";

export default async function Page() {
  const { access } = await requireRepositoryAccess("/workflows/runs");
  const history = await readWorkflowRunHistory(access.repositoryId, WORKFLOW_HISTORY_LIMIT);
  const header = <PageHeader title="Workflow runs" description="Review current and completed Workflow executions." />;
  if (history.status === "unavailable") return <>{header}<WorkflowServiceUnavailable retryPath="/workflows/runs" /></>;
  const { runs } = history;
  return <>{header}
    {runs.length ? <WorkflowRunsTable runs={runs.map(run => ({
      id: run.id, workflowName: workflowRunName(run), status: run.status, createdAt: run.createdAt,
      startedAt: run.startedAt, completedAt: run.completedAt, currentStepId: run.currentStepId,
    }))} /> : <EmptyState title="No workflow runs yet">Runs appear here after a Workflow is started.</EmptyState>}
  </>;
}
