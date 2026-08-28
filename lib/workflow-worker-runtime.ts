/**
 * Production composition point for the Workflow entrypoint. D1 state is intentionally
 * accessed only server-side. The full D1 adapter is installed by the application runtime.
 */
import type { WorkflowStep } from "cloudflare:workers";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";
import { createAgentRuntimeRegistry } from "./agent-runtime.ts";
import { codexRunnerDescriptor,resolveConnection } from "./workflow-connections.ts";
import {D1WorkflowProviderConnectionStore,type ProviderConnectionDatabase} from "./workflow-provider-connection-store.ts";
import { executeDurableGraphNodeTurn,executeDurableWorkflow,MAX_WORKFLOW_RUN_MS,NO_PLATFORM_RETRY, type DurableStep } from "./workflow-durable-driver.ts";
import {resolveGitSnapshotCredential} from "./git-workflow-provider-connection-store.ts";
import {createWorkflowProviderSecretResolver} from "./workflow-provider-secret-resolver.ts";
import {D1ProviderCredentialVault,type ProviderCredentialVaultDatabase} from "./provider-credential-vault.ts";
import {providerCredentialVaultV1KeyResolver} from "./provider-credential-vault-crypto.ts";
import type {ConnectionDescriptor,ResolvedConnection} from "./workflow-connections.ts";
import {issueArtifactSearchAuthority} from "./artifact-search-tool.ts";
import {RemoteOpenAIAgentsRuntime,RemoteRuntimeFailure,type ADTRuntimeConfiguration,type LangGraphAdvanceRequest,type LangGraphAdvanceResult} from "./adt-runtime-client.ts";
import {issueCheckpointAuthority,issueGraphNodeAuthority,type GraphNodeAuthorityScope} from "./langgraph-checkpoints.ts";
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

export async function executeWorkflowGraphNode(env:CloudflareEnv,scope:GraphNodeAuthorityScope,inputText:string){if(!env.AUTH_SESSIONS_DB)throw new Error("workflow_storage_unavailable");const storage=new D1WorkflowRunStorage(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database),detail=await storage.getRun(scope.runId),attempt=scope.activationId?detail?.attempts.filter(value=>value.stepId===scope.nodeId&&value.graphActivationId===scope.activationId).at(-1):detail?.attempts.filter(value=>value.stepId===scope.nodeId).at(-1);if(!detail||detail.run.engineVersion!=="2"||detail.run.workflowGeneration!==scope.workflowGeneration||!attempt||attempt.iteration!==scope.iteration||attempt.attempt!==scope.attempt)throw new Error("invalid_graph_node");const composition=executionComposition(env);return executeDurableGraphNodeTurn({runId:scope.runId,nodeId:scope.nodeId,activationId:scope.activationId,inputText,storage,runtimes:composition.runtimes,resolveConnection:composition.resolveConnectionForRun})}

const MAX_LANGGRAPH_RECOVERY_FAILURES=6,MAX_LANGGRAPH_TRANSPORT_TURNS=32_768;
const recoveryDelay=(failure:number)=>[1_000,2_000,5_000,10_000,30_000,30_000][Math.min(failure-1,5)];
type LangGraphRemote={advanceLangGraph(input:LangGraphAdvanceRequest):Promise<LangGraphAdvanceResult>};
export async function executeLangGraphWorkflow(input:{runId:string;storage:import("./workflow-storage.ts").WorkflowRunStorage;remote:LangGraphRemote;step:DurableStep;checkpointUrl:string;nodeUrl:string;checkpointAuthority:()=>Promise<string>;nodeAuthority:(scope:GraphNodeAuthorityScope)=>Promise<string>;now?:()=>number}){
 const {runId,storage,remote,step}=input,now=input.now??Date.now;let failures=0;
 for(let turn=0;turn<MAX_LANGGRAPH_TRANSPORT_TURNS;turn++){
  const current=await storage.getRun(runId);if(!current)throw new Error("run_not_found");
  if(["succeeded","failed","cancelled"].includes(current.run.status))return{runId,status:current.run.status};
  if(!current.run.executionPlan||current.run.engineVersion!=="2"){await storage.failRun(runId,"internal_error","The immutable Workflow execution plan is invalid.");return{runId,status:"failed" as const}}
  if(now()-Date.parse(current.run.createdAt)>MAX_WORKFLOW_RUN_MS){await storage.failRun(runId,"provider_timeout","The workflow run exceeded its time limit.");return{runId,status:"failed" as const}}
  let result:LangGraphAdvanceResult;
  try{result=await step.do(`${runId}:langgraph:${current.run.workflowGeneration}:${turn}`,NO_PLATFORM_RETRY,async()=>{const checkpointGateway={url:input.checkpointUrl,authority:await input.checkpointAuthority()},base={runId,initialInput:current.run.initialInput,plan:current.run.executionPlan!,checkpointGateway},inspection=await remote.advanceLangGraph({...base,nodeGateway:{url:input.nodeUrl}});if(inspection.state!=="admission_required")return inspection;const admitted=await storage.getRun(runId);if(!admitted||admitted.run.engineVersion!=="2"||admitted.run.workflowGeneration!==current.run.workflowGeneration)throw new Error("invalid_graph_admission");if("planVersion" in current.run.executionPlan!){if(!inspection.frontier?.length)throw new Error("invalid_graph_admission");const authorities=await Promise.all(inspection.frontier.map(async activation=>{const attempt=await storage.ensureGraphActivation(runId,activation.nodeId,activation.activationId);if(!["pending","starting","waiting_provider","succeeded","failed"].includes(attempt.status))throw new Error("invalid_graph_admission");const scope={runId,nodeId:activation.nodeId,activationId:activation.activationId,workflowGeneration:admitted.run.workflowGeneration,iteration:attempt.iteration,attempt:attempt.attempt};return{...scope,authority:await input.nodeAuthority(scope)}}));return remote.advanceLangGraph({...base,nodeGateway:{url:input.nodeUrl,authorities}})}if(!inspection.nextNodeId)throw new Error("invalid_graph_admission");const attempt=admitted.attempts.filter(value=>value.stepId===inspection.nextNodeId).at(-1);if(!attempt)throw new Error("invalid_graph_admission");const scope={runId,nodeId:inspection.nextNodeId,workflowGeneration:admitted.run.workflowGeneration,iteration:attempt.iteration,attempt:attempt.attempt},authority=await input.nodeAuthority(scope);return remote.advanceLangGraph({...base,nodeGateway:{url:input.nodeUrl,authority,...scope}})});failures=0}
  catch(error){const runtime=error instanceof RemoteRuntimeFailure?error:undefined;if(runtime?.runtimeCode==="capability_unavailable"){await storage.failRun(runId,"connection_unavailable","ADT Runtime LangGraph capability is unavailable.");return{runId,status:"failed" as const}}if(runtime&&["authentication_failed","configuration_invalid"].includes(runtime.category)){await storage.failRun(runId,runtime.category,runtime.safeMessage);return{runId,status:"failed" as const}}failures++;if(failures>MAX_LANGGRAPH_RECOVERY_FAILURES){await storage.failRun(runId,"provider_unavailable","Workflow orchestration remained unavailable after bounded recovery.");return{runId,status:"failed" as const}}await step.sleep(`${runId}:langgraph:${current.run.workflowGeneration}:recovery:${turn}`,recoveryDelay(failures));continue}
  if(result.state==="completed"){const durable=await storage.getRun(runId),terminal=durable?.attempts.filter(attempt=>attempt.stepId===current.run.executionPlan!.terminalNodeId&&attempt.status==="succeeded").at(-1);if(!terminal||terminal.outputText===undefined||result.outputText!==terminal.outputText){await storage.failRun(runId,"internal_error","Workflow terminal result could not be reconciled.");return{runId,status:"failed" as const}}await storage.completeRun(runId,current.run.executionPlan.terminalNodeId,terminal.outputText,terminal.outputExternalUrl);return{runId,status:"succeeded" as const}}
  if(result.state==="execution_limit"){await storage.failRun(runId,"internal_error","The workflow execution limit was reached.");return{runId,status:"failed" as const}}
  if(result.state==="failed"){const refreshed=await storage.getRun(runId);if(refreshed&&["failed","cancelled"].includes(refreshed.run.status))return{runId,status:refreshed.run.status};await storage.failRun(runId,"internal_error","Workflow node state could not be reconciled.");return{runId,status:"failed" as const}}
  if(result.state==="cancelled"){const refreshed=await storage.getRun(runId);if(refreshed?.run.status==="cancelling")await storage.cancelRun(runId);return{runId,status:"cancelled" as const}}
  if(result.state==="pending")await step.sleep(`${runId}:langgraph:${current.run.workflowGeneration}:${turn}:wait`,result.retryAfterMs??1_000);
 }
 await storage.failRun(runId,"internal_error","The workflow orchestration recovery limit was reached.");return{runId,status:"failed" as const};
}

export async function executeWorkflowRun(env: CloudflareEnv, runId: string, instanceId: string, step: WorkflowStep) {
 if (!env.AUTH_SESSIONS_DB) throw new Error("workflow_storage_unavailable");if (!runId || !instanceId) throw new Error("invalid_workflow_context");
 const storage=new D1WorkflowRunStorage(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database),detail=await storage.getRun(runId);if(!detail)throw new Error("run_not_found");await storage.attachWorkflowInstance(runId,detail.run.workflowGeneration,instanceId);
 const composition=executionComposition(env);if(workflowExecutionDriver(detail.run)==="sequential")return executeDurableWorkflow({runId,storage,runtimes:composition.runtimes,resolveConnection:composition.resolveConnectionForRun,step:step as unknown as DurableStep});
 if(!detail.run.executionPlan)throw new Error("invalid_run_snapshot");const checkpointUrl=composition.runtimeEnv.ADT_CHECKPOINT_GATEWAY_URL,nodeUrl=composition.runtimeEnv.ADT_GRAPH_NODE_GATEWAY_URL;if(!checkpointUrl||!nodeUrl)throw new Error("langgraph_gateway_unavailable");
 return executeLangGraphWorkflow({runId,storage,remote:new RemoteOpenAIAgentsRuntime(createWorkflowADTRuntimeConfiguration(composition.runtimeEnv)),step:step as unknown as DurableStep,checkpointUrl,nodeUrl,checkpointAuthority:()=>issueCheckpointAuthority(runId,composition.runtimeEnv.ADT_CHECKPOINT_AUTHORITY_SECRET??""),nodeAuthority:scope=>issueGraphNodeAuthority(scope,composition.runtimeEnv.ADT_GRAPH_NODE_AUTHORITY_SECRET??"")});
}
