/**
 * Production composition point for the Workflow entrypoint. D1 state is intentionally
 * accessed only server-side. The full D1 adapter is installed by the application runtime.
 */
import type { WorkflowStep } from "cloudflare:workers";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";
import { createWorkflowAdapterRegistry } from "./openai-responses-adapter.ts";
import { codexRunnerDescriptor,resolveConnection } from "./workflow-connections.ts";
import {D1WorkflowProviderConnectionStore,type ProviderConnectionDatabase} from "./workflow-provider-connection-store.ts";
import { executeDurableWorkflow, type DurableStep } from "./workflow-durable-driver.ts";
import {resolveGitSnapshotCredential} from "./git-workflow-provider-connection-store.ts";
import {createWorkflowProviderSecretResolver} from "./workflow-provider-secret-resolver.ts";

export async function executeWorkflowRun(env: CloudflareEnv, runId: string, instanceId: string, step: WorkflowStep) {
  if (!env.AUTH_SESSIONS_DB) throw new Error("workflow_storage_unavailable");
  if (!runId || !instanceId) throw new Error("invalid_workflow_context");
  const storage=new D1WorkflowRunStorage(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database);
  const detail=await storage.getRun(runId);if(!detail)throw new Error("run_not_found");await storage.attachWorkflowInstance(runId,detail.run.workflowGeneration,instanceId);
  const providerSecrets=createWorkflowProviderSecretResolver(ref=>(env as unknown as Record<string,unknown>)[ref]);
  const providers=new D1WorkflowProviderConnectionStore(env.AUTH_SESSIONS_DB as unknown as ProviderConnectionDatabase,env.WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY);
  return executeDurableWorkflow({runId,storage,adapters:createWorkflowAdapterRegistry(),resolveConnection:(key,snapshot)=>key==="deterministic-test"?Promise.resolve(resolveConnection(key,env as unknown as Record<string,string|undefined>)):key==="codex-primary"?Promise.resolve({...codexRunnerDescriptor(true),serverConfiguration:{baseUrl:env.CODEX_RUNNER_BASE_URL,accessClientId:env.CODEX_RUNNER_ACCESS_CLIENT_ID,accessClientSecret:env.CODEX_RUNNER_ACCESS_CLIENT_SECRET,sharedSecret:env.CODEX_RUNNER_SHARED_SECRET}}):snapshot?.management==="git"?Promise.resolve(resolveGitSnapshotCredential(key,snapshot,providerSecrets)):providers.resolveCredential(key),step:step as unknown as DurableStep});
}
