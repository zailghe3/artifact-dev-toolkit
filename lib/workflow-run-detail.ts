import { reconcileWorkflowLaunch, type WorkflowBinding } from "./workflow-launch.ts";
import { getWorkflowEnvironment, getWorkflowRunStorage } from "./workflow-services.ts";
import type { RunDetail, WorkflowRunStorage } from "./workflow-storage.ts";

type RunDetailDependencies = {
  storage?: WorkflowRunStorage;
  binding?: WorkflowBinding;
};

/** Loads the latest run detail and performs only bounded abandoned-launch reconciliation. */
export async function getWorkflowRunDetail(
  runId: string,
  dependencies: RunDetailDependencies = {},
): Promise<RunDetail | undefined> {
  const storage = dependencies.storage ?? await getWorkflowRunStorage();
  const detail = await storage.getRun(runId);
  if (!detail) return undefined;

  const { run } = detail;
  if (run.workflowLaunchState !== "launching" || ["succeeded", "failed", "cancelled"].includes(run.status)) {
    return detail;
  }

  const binding = dependencies.binding ?? (await getWorkflowEnvironment()).AGENT_RUN_WORKFLOW;
  await reconcileWorkflowLaunch(storage, binding, detail);
  return await storage.getRun(runId);
}
