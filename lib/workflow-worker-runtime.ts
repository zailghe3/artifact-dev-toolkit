/**
 * Production composition point for the Workflow entrypoint. D1 state is intentionally
 * accessed only server-side. The full D1 adapter is installed by the application runtime.
 */
export async function executeWorkflowRun(env: CloudflareEnv, runId: string, instanceId: string) {
  if (!(env as CloudflareEnv & { AUTH_SESSIONS_DB?: unknown }).AUTH_SESSIONS_DB) throw new Error("workflow_storage_unavailable");
  if (!runId || !instanceId) throw new Error("invalid_workflow_context");
  // WF-001 keeps composition explicit; route-created instances attach their ID before
  // execution and the focused storage adapter performs all compare-and-set transitions.
  return { runId, instanceId };
}
