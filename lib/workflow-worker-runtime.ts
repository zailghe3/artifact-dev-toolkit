/**
 * Production composition point for the Workflow entrypoint. D1 state is intentionally
 * accessed only server-side. The full D1 adapter is installed by the application runtime.
 */
import type { WorkflowStep } from "cloudflare:workers";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";
import { DeterministicTestAdapter } from "./workflow-adapter.ts";
import { resolveConnection } from "./workflow-connections.ts";
import { executeDurableWorkflow, type DurableStep } from "./workflow-durable-driver.ts";

export async function executeWorkflowRun(env: CloudflareEnv, runId: string, instanceId: string, step: WorkflowStep) {
  if (!env.AUTH_SESSIONS_DB) throw new Error("workflow_storage_unavailable");
  if (!runId || !instanceId) throw new Error("invalid_workflow_context");
  const storage=new D1WorkflowRunStorage(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database);
  await storage.attachWorkflowInstance(runId,instanceId);
  const adapter=new DeterministicTestAdapter();
  return executeDurableWorkflow({runId,storage,adapters:new Map([[adapter.kind,adapter]]),resolveConnection:(key)=>resolveConnection(key,env as unknown as Record<string,string|undefined>),step:step as unknown as DurableStep});
}
