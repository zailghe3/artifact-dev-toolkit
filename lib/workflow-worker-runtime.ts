/**
 * Production composition point for the Workflow entrypoint. D1 state is intentionally
 * accessed only server-side. The full D1 adapter is installed by the application runtime.
 */
import type { WorkflowStep } from "cloudflare:workers";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";
import { createAgentRuntimeRegistry } from "./agent-runtime.ts";
import { codexRunnerDescriptor,resolveConnection } from "./workflow-connections.ts";
import {D1WorkflowProviderConnectionStore,type ProviderConnectionDatabase} from "./workflow-provider-connection-store.ts";
import { executeDurableGraphNodeTurn,executeDurableWorkflow,NO_PLATFORM_RETRY, type DurableStep } from "./workflow-durable-driver.ts";
import {resolveGitSnapshotCredential} from "./git-workflow-provider-connection-store.ts";
import {createWorkflowProviderSecretResolver} from "./workflow-provider-secret-resolver.ts";
import {D1ProviderCredentialVault,type ProviderCredentialVaultDatabase} from "./provider-credential-vault.ts";
import {providerCredentialVaultV1KeyResolver} from "./provider-credential-vault-crypto.ts";
import type {ConnectionDescriptor,ResolvedConnection} from "./workflow-connections.ts";
import {issueArtifactSearchAuthority} from "./artifact-search-tool.ts";
import {RemoteOpenAIAgentsRuntime,RemoteRuntimeFailure,type ADTRuntimeConfiguration} from "./adt-runtime-client.ts";
import {issueCheckpointAuthority,issueGraphNodeAuthority} from "./langgraph-checkpoints.ts";
import type {WorkflowRun} from "./workflow-storage.ts";

export function workflowExecutionDriver(run:Pick<WorkflowRun,"engineVersion">){return run.engineVersion==="1"?"sequential" as const:"langgraph" as const}

export function createWorkflowADTRuntimeConfiguration(env:Record<string,string|undefined>):ADTRuntimeConfiguration{return{baseUrl:env.ADT_RUNTIME_BASE_URL,authSecret:env.ADT_RUNTIME_AUTH_SECRET,wrappingPublicKey:env.ADT_RUNTIME_WRAPPING_PUBLIC_KEY,toolGatewayUrl:env.ADT_TOOL_GATEWAY_URL,toolAuthority:async invocation=>{const context=invocation.repositoryContext;if(!context)throw new Error("tool_repository_context_unavailable");return issueArtifactSearchAuthority({version:1,runId:invocation.runId,stepId:invocation.stepId,iteration:invocation.iteration,attempt:invocation.attempt,...context,expiresAt:Date.now()+5*60_000,nonce:crypto.randomUUID()},env.ADT_TOOL_AUTHORITY_SECRET??"")}}}

export function createWorkflowExecutionConnectionResolver(env:CloudflareEnv){
 const providerSecrets=createWorkflowProviderSecretResolver(ref=>(env as unknown as Record<string,unknown>)[ref]);
 const providers=new D1WorkflowProviderConnectionStore(env.AUTH_SESSIONS_DB as unknown as ProviderConnectionDatabase,env.WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY);
 const vault=new D1ProviderCredentialVault(env.AUTH_SESSIONS_DB as unknown as ProviderCredentialVaultDatabase,providerCredentialVaultV1KeyResolver(env.WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY));
 return (key:string,snapshot?:ConnectionDescriptor):Promise<ResolvedConnection>=>snapshot?.management==="git"?Promise.resolve(resolveGitSnapshotCredential(key,snapshot,providerSecrets,vault)):providers.resolveCredential(key);
}

function executionComposition(env:CloudflareEnv){const resolveProviderConnection=createWorkflowExecutionConnectionResolver(env),runtimeEnv=env as unknown as Record<string,string|undefined>,runtimes=createAgentRuntimeRegistry(undefined,createWorkflowADTRuntimeConfiguration(runtimeEnv)),resolveConnectionForRun=(key:string,snapshot?:ConnectionDescriptor)=>key==="deterministic-test"?Promise.resolve(resolveConnection(key,env as unknown as Record<string,string|undefined>)):key==="codex-primary"?Promise.resolve({...codexRunnerDescriptor(true),serverConfiguration:{baseUrl:env.CODEX_RUNNER_BASE_URL,accessClientId:env.CODEX_RUNNER_ACCESS_CLIENT_ID,accessClientSecret:env.CODEX_RUNNER_ACCESS_CLIENT_SECRET,sharedSecret:env.CODEX_RUNNER_SHARED_SECRET}}):resolveProviderConnection(key,snapshot);return{runtimes,resolveConnectionForRun,runtimeEnv}}

export async function executeWorkflowGraphNode(env:CloudflareEnv,runId:string,nodeId:string,inputText:string){if(!env.AUTH_SESSIONS_DB)throw new Error("workflow_storage_unavailable");const storage=new D1WorkflowRunStorage(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database),composition=executionComposition(env);return executeDurableGraphNodeTurn({runId,nodeId,inputText,storage,runtimes:composition.runtimes,resolveConnection:composition.resolveConnectionForRun})}

export async function executeWorkflowRun(env: CloudflareEnv, runId: string, instanceId: string, step: WorkflowStep) {
  if (!env.AUTH_SESSIONS_DB) throw new Error("workflow_storage_unavailable");
  if (!runId || !instanceId) throw new Error("invalid_workflow_context");
  const storage=new D1WorkflowRunStorage(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database);
  const detail=await storage.getRun(runId);if(!detail)throw new Error("run_not_found");await storage.attachWorkflowInstance(runId,detail.run.workflowGeneration,instanceId);
  const composition=executionComposition(env);if(workflowExecutionDriver(detail.run)==="sequential")return executeDurableWorkflow({runId,storage,runtimes:composition.runtimes,resolveConnection:composition.resolveConnectionForRun,step:step as unknown as DurableStep});
  if(!detail.run.executionPlan)throw new Error("invalid_run_snapshot");const checkpointUrl=composition.runtimeEnv.ADT_CHECKPOINT_GATEWAY_URL,nodeUrl=composition.runtimeEnv.ADT_GRAPH_NODE_GATEWAY_URL;if(!checkpointUrl||!nodeUrl)throw new Error("langgraph_gateway_unavailable");const remote=new RemoteOpenAIAgentsRuntime(createWorkflowADTRuntimeConfiguration(composition.runtimeEnv));for(let turn=0;turn<detail.run.executionPlan.maxStepExecutions*16;turn++){const current=await storage.getRun(runId);if(!current)throw new Error("run_not_found");if(["succeeded","failed","cancelled"].includes(current.run.status))return{runId,status:current.run.status};let result;try{result=await (step as unknown as DurableStep).do(`${runId}:langgraph:${current.run.workflowGeneration}:${turn}`,NO_PLATFORM_RETRY,async()=>remote.advanceLangGraph({runId,initialInput:current.run.initialInput,plan:current.run.executionPlan!,checkpointGateway:{url:checkpointUrl,authority:await issueCheckpointAuthority(runId,composition.runtimeEnv.ADT_CHECKPOINT_AUTHORITY_SECRET??"")},nodeGateway:{url:nodeUrl,authority:await issueGraphNodeAuthority(runId,composition.runtimeEnv.ADT_GRAPH_NODE_AUTHORITY_SECRET??"")}}))}catch(error){if(error instanceof RemoteRuntimeFailure&&error.runtimeCode==="capability_unavailable"){await storage.failRun(runId,"connection_unavailable","ADT Runtime LangGraph capability is unavailable.");return{runId,status:"failed" as const}}throw error}if(result.state==="completed"){await storage.completeRun(runId,current.run.executionPlan!.terminalNodeId,result.outputText??"");return{runId,status:"succeeded" as const}}if(result.state==="failed"){await storage.failRun(runId,"provider_rejected",result.safeMessage??"The workflow node failed.");return{runId,status:"failed" as const}}if(result.state==="cancelled"){const refreshed=await storage.getRun(runId);if(refreshed?.run.status==="cancelling")await storage.cancelRun(runId);return{runId,status:"cancelled" as const}}if(result.state==="pending")await (step as unknown as DurableStep).sleep(`${runId}:langgraph:${current.run.workflowGeneration}:${turn}:wait`,1000)}await storage.failRun(runId,"internal_error","The workflow execution limit was reached.");return{runId,status:"failed" as const};
}
