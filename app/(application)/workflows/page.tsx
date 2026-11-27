import { Suspense } from "react";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { EmptyState, PageHeader } from "@/components/Ui";
import { WorkflowRunsTable, type WorkflowRunTableRow } from "@/components/WorkflowRunsTable";
import { requireRepositoryAccess } from "@/lib/auth";
import { workflowRunName } from "@/lib/workflow-run-presentation";
import { WorkflowServiceUnavailable } from "@/components/WorkflowServiceUnavailable";
import { WORKFLOW_OVERVIEW_HISTORY_LIMIT } from "@/lib/runtime-service-client";
import { readWorkflowRunHistory } from "@/lib/workflow-services";
import type { WorkflowRun } from "@/lib/workflow-storage";

function row(run: WorkflowRun): WorkflowRunTableRow {
  return { id: run.id, workflowName: workflowRunName(run), status: run.status, createdAt: run.createdAt,
    startedAt: run.startedAt, completedAt: run.completedAt, currentStepId: run.currentStepId };
}

export default async function WorkflowsPage() {
  const { access } = await requireRepositoryAccess("/workflows");
  const history = readWorkflowRunHistory(access.repositoryId, WORKFLOW_OVERVIEW_HISTORY_LIMIT);
  return (
    <>
      <PageHeader title="Workflows" description="Manage definitions and inspect durable execution."
        action={{ href: "/conversations", label: "New conversation" }} />
      <Suspense fallback={<ContentLoading label="Loading active and recent runs" rows={2} />}>
        <AsyncContent data={history} failure="Workflow runs could not be loaded.">
          {history => {
            if (history.status === "unavailable") return <WorkflowServiceUnavailable retryPath="/workflows" />;
            const { runs } = history;
            const active = runs.filter(run => !["succeeded", "failed", "cancelled"].includes(run.status));
            return (
              <div className="grid gap-8">
                <section aria-labelledby="active-runs-heading">
                  <h2 id="active-runs-heading" className="mb-3 text-lg font-semibold">Active runs</h2>
                  {active.length ? <WorkflowRunsTable runs={active.map(row)} /> : <EmptyState>There are no active runs.</EmptyState>}
                </section>
                <section aria-labelledby="recent-runs-heading">
                  <h2 id="recent-runs-heading" className="mb-3 text-lg font-semibold">Recent runs</h2>
                  {runs.length ? <WorkflowRunsTable runs={runs.map(row)} /> : <EmptyState>There are no workflow runs yet.</EmptyState>}
                </section>
              </div>
            );
          }}
        </AsyncContent>
      </Suspense>
    </>
  );
}
