/**
 * Production composition point for the Workflow entrypoint. D1 state is intentionally
 * accessed only server-side. The full D1 adapter is installed by the application runtime.
 */
import type { WorkflowStep } from "cloudflare:workers";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";
import { createAgentRuntimeRegistry } from "./agent-runtime.ts";
import { codexRunnerDescriptor,resolveConnection } from "./workflow-connections.ts";
import {D1WorkflowProviderConnectionStore,type ProviderConnectionDatabase} from "./workflow-provider-connection-store.ts";
import { executeDurableWorkflow, type DurableStep } from "./workflow-durable-driver.ts";
import {resolveGitSnapshotCredential} from "./git-workflow-provider-connection-store.ts";
import {createWorkflowProviderSecretResolver} from "./workflow-provider-secret-resolver.ts";
import {D1ProviderCredentialVault,type ProviderCredentialVaultDatabase} from "./provider-credential-vault.ts";
import {providerCredentialVaultV1KeyResolver} from "./provider-credential-vault-crypto.ts";
import type {ConnectionDescriptor,ResolvedConnection} from "./workflow-connections.ts";
import {issueArtifactSearchAuthority} from "./artifact-search-tool.ts";
import type {ADTRuntimeConfiguration} from "./adt-runtime-client.ts";

export function createWorkflowADTRuntimeConfiguration(env:Record<string,string|undefined>):ADTRuntimeConfiguration{return{baseUrl:env.ADT_RUNTIME_BASE_URL,authSecret:env.ADT_RUNTIME_AUTH_SECRET,wrappingPublicKey:env.ADT_RUNTIME_WRAPPING_PUBLIC_KEY,toolGatewayUrl:env.ADT_TOOL_GATEWAY_URL,toolAuthority:async invocation=>{const context=invocation.repositoryContext;if(!context)throw new Error("tool_repository_context_unavailable");return issueArtifactSearchAuthority({version:1,runId:invocation.runId,stepId:invocation.stepId,iteration:invocation.iteration,attempt:invocation.attempt,...context,expiresAt:Date.now()+5*60_000,nonce:crypto.randomUUID()},env.ADT_TOOL_AUTHORITY_SECRET??"")}}}

export function createWorkflowExecutionConnectionResolver(env:CloudflareEnv){
 const providerSecrets=createWorkflowProviderSecretResolver(ref=>(env as unknown as Record<string,unknown>)[ref]);
 const providers=new D1WorkflowProviderConnectionStore(env.AUTH_SESSIONS_DB as unknown as ProviderConnectionDatabase,env.WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY);
 const vault=new D1ProviderCredentialVault(env.AUTH_SESSIONS_DB as unknown as ProviderCredentialVaultDatabase,providerCredentialVaultV1KeyResolver(env.WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY));
 return (key:string,snapshot?:ConnectionDescriptor):Promise<ResolvedConnection>=>snapshot?.management==="git"?Promise.resolve(resolveGitSnapshotCredential(key,snapshot,providerSecrets,vault)):providers.resolveCredential(key);
}

export async function executeWorkflowRun(env: CloudflareEnv, runId: string, instanceId: string, step: WorkflowStep) {
  if (!env.AUTH_SESSIONS_DB) throw new Error("workflow_storage_unavailable");
  if (!runId || !instanceId) throw new Error("invalid_workflow_context");
  const storage=new D1WorkflowRunStorage(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database);
  const detail=await storage.getRun(runId);if(!detail)throw new Error("run_not_found");await storage.attachWorkflowInstance(runId,detail.run.workflowGeneration,instanceId);
  const resolveProviderConnection=createWorkflowExecutionConnectionResolver(env);
  const runtimeEnv=env as unknown as Record<string,string|undefined>;
  return executeDurableWorkflow({runId,storage,runtimes:createAgentRuntimeRegistry(undefined,createWorkflowADTRuntimeConfiguration(runtimeEnv)),resolveConnection:(key,snapshot)=>key==="deterministic-test"?Promise.resolve(resolveConnection(key,env as unknown as Record<string,string|undefined>)):key==="codex-primary"?Promise.resolve({...codexRunnerDescriptor(true),serverConfiguration:{baseUrl:env.CODEX_RUNNER_BASE_URL,accessClientId:env.CODEX_RUNNER_ACCESS_CLIENT_ID,accessClientSecret:env.CODEX_RUNNER_ACCESS_CLIENT_SECRET,sharedSecret:env.CODEX_RUNNER_SHARED_SECRET}}):resolveProviderConnection(key,snapshot),step:step as unknown as DurableStep});
}
