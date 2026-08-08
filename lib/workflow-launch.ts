import type { RunDetail, WorkflowRunStorage } from "./workflow-storage.ts";

export type WorkflowBinding = { create(input: { id: string; params: { runId: string } }): Promise<{ id: string }> };
export type WorkflowLaunchResult =
  | { state: "attached"; instanceId: string; launched: false }
  | { state: "launched"; instanceId: string; launched: true }
  | { state: "in_progress"; instanceId: string; launched: false };

export async function ensureWorkflowLaunched(storage: WorkflowRunStorage, binding: WorkflowBinding, runId: string, generation: number): Promise<WorkflowLaunchResult> {
  const proposed = `${runId}-g${generation}`, claim = await storage.claimWorkflowLaunch(runId, generation, proposed);
  if (claim.result === "terminal") throw new Error("invalid_launch_state");
  if (claim.result === "already_attached") return { state: "attached", instanceId: claim.instanceId, launched: false };
  if (claim.result === "launch_in_progress") return { state: "in_progress", instanceId: claim.instanceId, launched: false };
  try {
    const instance = await binding.create({ id: claim.instanceId, params: { runId } });
    await storage.attachWorkflowInstance(runId, generation, claim.instanceId);
    return { state: "launched", instanceId: instance.id, launched: true };
  } catch (error) {
    const duplicate = error && typeof error === "object" && ("status" in error && error.status === 409 || "code" in error && error.code === "instance_already_exists");
    if (duplicate) { await storage.attachWorkflowInstance(runId, generation, claim.instanceId); return { state: "attached", instanceId: claim.instanceId, launched: false }; }
    await storage.recordWorkflowLaunchFailure(runId, generation, claim.instanceId, "The durable workflow could not be started.");
    throw Object.assign(new Error("workflow_launch_unavailable"), { code: "workflow_launch_unavailable" });
  }
}

/** Launches only runs whose persisted launch state calls for reconciliation. */
export async function reconcileWorkflowLaunch(storage: WorkflowRunStorage, binding: WorkflowBinding, detail: RunDetail): Promise<WorkflowLaunchResult | undefined> {
  const { run } = detail;
  if (run.workflowLaunchState === "attached") return undefined;
  if (run.workflowLaunchState === "launching" && !["succeeded", "failed", "cancelled"].includes(run.status)) return ensureWorkflowLaunched(storage, binding, run.id, run.workflowGeneration);
  if (run.workflowLaunchState === "unclaimed" || run.workflowLaunchState === "launch_failed") return ensureWorkflowLaunched(storage, binding, run.id, run.workflowGeneration);
  return undefined;
}
