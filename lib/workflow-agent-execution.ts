import {D1McpPolicyAuthority,type McpAdmissionAuthority} from "./mcp-policy-authority.ts";
import {AgentJournal,agentDigest} from "./agent-journal.ts";
import {progressDurableAgent,builtinSearchTool,defaultToolPolicy,type AgentTool} from "./agent-execution.ts";
import {RemoteOpenAIAgentsRuntime,type ADTRuntimeConfiguration} from "./adt-runtime-client.ts";
import {resolveFrozenMcpTools} from "./mcp-tool-authority.ts";
import {resolveFrozenSecurityProfile} from "./security-profile-authority.ts";
import {D1ProviderCredentialVault,type ProviderCredentialVaultDatabase} from "./provider-credential-vault.ts";
import {providerCredentialVaultV1KeyResolver} from "./provider-credential-vault-crypto.ts";
import {hasArtifactSearchGrant,type AgentDefinitionV1} from "./workflow-definitions.ts";
import type {RunDetail,StepAttempt,WorkflowRunStorage} from "./workflow-storage.ts";
import type {WorkflowD1Database} from "./workflow-d1-storage.ts";
import type {GraphNodeAuthorityScope} from "./langgraph-checkpoints.ts";
import type {ConnectionDescriptor,ResolvedConnection} from "./workflow-connections.ts";
import {providerExecutionTimeoutMs} from "./provider-execution-timeouts.ts";
import {boundedArtifactSearch} from "./artifact-search-tool.ts";
import {createGitHubAppJwt,mintInstallationToken} from "./github-app.ts";
import type {RepositoryAccessContext} from "./repository-authorization.ts";
import {blockToolsSchema,grantKey,type ModelProgress} from "../adt-runtime/src/agent-contract.ts";

export async function executeJournaledWorkflowAgent(input:{env:CloudflareEnv;scope:GraphNodeAuthorityScope;inputText:string;detail:RunDetail;attempt:StepAttempt;agent:AgentDefinitionV1;restrictions?:unknown;storage:WorkflowRunStorage;configuration:ADTRuntimeConfiguration;toolRepository?:Pick<import("./tool-definition-repository.ts").ToolDefinitionRepository,"get">;runtime?:Pick<RemoteOpenAIAgentsRuntime,"agentOperation">;resolveConnection:(key:string,snapshot?:ConnectionDescriptor)=>Promise<ResolvedConnection>}){
 const {env,scope,storage,agent}=input,values=env as unknown as Record<string,string>,database=env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database,journal=new AgentJournal(database,undefined,values),detail=input.detail;
 if(detail.run.cancelRequestedAt||["cancelled","cancelling"].includes(detail.run.status))return{state:"cancelled" as const};
 if(input.attempt.status==="succeeded")return{state:"completed" as const,outputText:input.attempt.outputText??""};
 if(!detail.run.executionPlan||!("agentExecutionContract" in detail.run.executionPlan)||detail.run.executionPlan.agentExecutionContract!==1){await storage.recordGraphFailure(scope.runId,"configuration_invalid","This historical tool execution contract requires cutover. Cancel the old run and launch a new frozen run.");return{state:"failed" as const,safeMessage:"Historical tool execution requires explicit cutover."}}
 let attempt=input.attempt,initialize=false;
 if(attempt.status==="succeeded")return{state:"completed" as const,outputText:attempt.outputText??""};
 if(attempt.status==="pending"){const claim=await storage.claimGraphNode(scope.runId,scope.nodeId,input.inputText,scope.activationId);attempt=claim.attempt;initialize=claim.claimed}
 if(attempt.status!=="starting")return{state:"failed" as const,safeMessage:"Agent activation cannot progress."};
 const id=agentDigest([scope.runId,scope.workflowGeneration,scope.nodeId,scope.activationId,scope.iteration,scope.attempt]);
 // Contract 1 cannot enter a model before creating its journal. A lost node-claim
 // response with no journal is therefore safe to initialise from persisted input.
 if(!await journal.get(id))initialize=true;

 const existingContinuation=await journal.get(id);
 if(detail.run.failureCode){
  if(existingContinuation?.state==="completed"){const last=JSON.parse(existingContinuation.conversation_json).at(-1) as {role:string;text:string;calls?:unknown[]};if(last.role!=="assistant"||last.calls?.length)throw Error("agent_final_state_invalid");await storage.completeStep(scope.runId,scope.nodeId,scope.iteration,scope.attempt,last.text);return{state:"pending" as const,retryAfterMs:1000}}
  if(existingContinuation){const outstanding=(await journal.calls(id)).find(call=>call.state==="admitted"||call.state==="unknown");if(outstanding){if(outstanding.state==="admitted")await journal.markUnknown(outstanding,"execution_deadline",true);return{state:"pending" as const,retryAfterMs:1000}}await journal.transition(existingContinuation,existingContinuation.state,"failed")}
  await storage.failStep(scope.runId,scope.nodeId,scope.iteration,scope.attempt,{category:detail.run.failureCode,safeMessage:detail.run.failureMessage??"Another Workflow branch failed.",retryable:false});const latest=await storage.getRun(scope.runId);return latest?.attempts.some(item=>["starting","waiting_provider"].includes(item.status))?{state:"pending" as const,retryAfterMs:1000}:{state:"failed" as const};
 }
 const persisted=await journal.get(id);if(persisted?.state==="reconciliation"&&(await journal.calls(id)).some(call=>call.state==="unknown"))return{state:"pending" as const,retryAfterMs:1000};
 try{
  const snapshot=detail.run.connectionSnapshots[agent.connectionKey],connection=await input.resolveConnection(agent.connectionKey,snapshot);if(!snapshot||!connection.enabled||connection.adapter!==snapshot.adapter)throw Error("connection_unavailable");
  const repository=detail.run.repositoryContext;if(!repository&&agent.tools?.length)throw Error("tool_repository_context_missing");
  const vault=new D1ProviderCredentialVault(database as unknown as ProviderCredentialVaultDatabase,providerCredentialVaultV1KeyResolver(env.WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY)),remote=input.runtime??new RemoteOpenAIAgentsRuntime(input.configuration),restrictions=blockToolsSchema.parse(input.restrictions??{}),grantKeys=(agent.tools??[]).map(grantKey),frozen=detail.run.mcpToolSnapshots?.[agent.id]??[];
  const expected=(agent.tools??[]).filter(grant=>typeof grant!=="string"&&grant.type==="mcp");if(expected.length!==frozen.length||expected.some(grant=>typeof grant!=="string"&&grant.type==="mcp"&&!frozen.some(tool=>tool.serverId===grant.serverId&&tool.tool.name===grant.toolName)))throw Error("mcp_run_snapshot_missing");
  const tools:AgentTool[]=[...(hasArtifactSearchGrant(agent.tools)?[builtinSearchTool]:[]),...frozen.map(tool=>({key:`mcp:${tool.serverId}:${tool.tool.name}`,alias:tool.alias,description:tool.tool.description??tool.tool.name,schema:tool.tool.inputSchema,target:tool.server.url,policy:tool.policy??defaultToolPolicy(),frozen:tool}))];
  if(restrictions.allowlist?.some(key=>!grantKeys.includes(key)))throw Error("workflow_tool_expansion");
  const access=():RepositoryAccessContext=>{if(!repository)throw Error("repository_missing");return{ok:true,owner:repository.owner,repo:repository.repository,login:"agent-tool",githubId:0,repositoryId:repository.repositoryId,installationId:repository.installationId,checkedAt:Date.now(),installationCredentialProvider:async capability=>mintInstallationToken(repository.installationId,repository.repositoryId,await createGitHubAppJwt(values.GITHUB_APP_ID,values.GITHUB_APP_PRIVATE_KEY),capability)}};
  const policyAuthority=new D1McpPolicyAuthority(database),admissionAuthorities=new Map<string,McpAdmissionAuthority>();
  const {GitHubToolDefinitionRepository}=await import("./tool-definition-repository.ts");
  const toolRepository=input.toolRepository??new GitHubToolDefinitionRepository(async(path,init)=>{const credential=await access().installationCredentialProvider("read"),url=new URL(`https://api.github.com/repos/${repository!.owner}/${repository!.repository}${path}`);url.searchParams.set("ref",repository!.branch);return fetch(url,{...init,headers:{accept:"application/vnd.github+json",authorization:`Bearer ${credential.token}`,"user-agent":"artifact-dev-toolkit"}})});
  const outcome=await progressDurableAgent({journal,id,runId:scope.runId,generation:scope.workflowGeneration,nodeId:scope.nodeId,activationId:scope.activationId??scope.nodeId,iteration:scope.iteration,attempt:scope.attempt,agent,provider:connection.adapter as ModelProgress["provider"],model:connection.defaultModel!,input:attempt.inputText??input.inputText,configuration:connection.providerConfiguration,timeoutMs:providerExecutionTimeoutMs(connection.adapter,agent.adapterOptions)??30000,restrictions,tools,initialize,
   admissionAuthority:tool=>{if(tool.key==="artifact_search")return undefined;const proof=admissionAuthorities.get(tool.alias);if(!proof)throw Error("mcp_policy_unverified");return proof},
   progress:request=>remote.agentOperation("/v1/agents/progress",{request},connection.credential),
   authorize:async(tool)=>{
    const current=await storage.getRun(scope.runId);if(!current||current.run.workflowGeneration!==scope.workflowGeneration||current.run.cancelRequestedAt||current.run.failureCode||["succeeded","failed","cancelled","cancelling"].includes(current.run.status))throw Error("run_not_active");
    // Read authority again after a human wait. Git edits never expand frozen grants.
    if(tool.key==="artifact_search"){await access().installationCredentialProvider("read");return[]}
    const selected=(await resolveFrozenMcpTools(repository!.repositoryId,agent,detail.run.mcpToolSnapshots,vault,{repository:toolRepository,policies:policyAuthority})).find(value=>value.alias===tool.alias);if(!selected)throw Error("tool_revoked");
    admissionAuthorities.set(tool.alias,selected.authorityGuard);return[selected.livePolicy];
   },
   security:async(conversation,call,identity)=>{const security=await resolveFrozenSecurityProfile(repository!.repositoryId,agent,detail.run.securityProfileSnapshots,vault);if(!security)return{outcome:"not_configured"};return remote.agentOperation("/v1/agents/security",{profile:{profileId:security.profileId,endpointUrl:security.endpointUrl,decisionTimeoutMs:security.decisionTimeoutMs},context:{id:identity,model:connection.defaultModel,instructions:agent.masterPrompt,conversation,call}},security.credential)},
   execute:async(tool,call,admissionId)=>{
    if(tool.key==="artifact_search"){const {getArtifactsForRepositoryContext}=await import("./artifacts.ts");const artifacts=await getArtifactsForRepositoryContext(access(),repository!);if(Date.now()>=call.execution_deadline_at!)throw Error("tool_dispatch_deadline");return boundedArtifactSearch(artifacts,JSON.parse(call.arguments_json))}
    const grants=await resolveFrozenMcpTools(repository!.repositoryId,agent,detail.run.mcpToolSnapshots,vault,{repository:toolRepository,policies:policyAuthority}),grant=grants.find(value=>value.alias===tool.alias);if(!grant||JSON.stringify(grant.authorityGuard)!==JSON.stringify(admissionAuthorities.get(tool.alias)))throw Error("tool_revoked");
    return remote.agentOperation("/v1/agents/tool",{admissionId,executionDeadlineAt:call.execution_deadline_at,invocationId:call.id,fingerprint:call.fingerprint,server:grant.server,tool:grant.tool,arguments:JSON.parse(call.arguments_json)},grant.credential);
   }
  });
  if(outcome.state==="completed"){await storage.completeStep(scope.runId,scope.nodeId,scope.iteration,scope.attempt,outcome.outputText??"");return{state:"completed" as const,outputText:outcome.outputText}}
  if(outcome.state==="failed"){await storage.failStep(scope.runId,scope.nodeId,scope.iteration,scope.attempt,{category:outcome.category??"provider_rejected",safeMessage:outcome.safeMessage??"Agent progression failed.",retryable:false});await storage.recordGraphFailure(scope.runId,outcome.category??"provider_rejected",outcome.safeMessage??"Agent progression failed.");const remaining=await storage.getRun(scope.runId);return remaining?.attempts.some(item=>["starting","waiting_provider"].includes(item.status))?{state:"pending" as const,retryAfterMs:1000}:{state:"failed" as const,safeMessage:outcome.safeMessage}}
  return{state:"pending" as const,retryAfterMs:1000};
 }catch{
  await storage.failStep(scope.runId,scope.nodeId,scope.iteration,scope.attempt,{category:"configuration_invalid",safeMessage:"Agent authority or configuration is unavailable. No automatic replay was made.",retryable:false});await storage.recordGraphFailure(scope.runId,"configuration_invalid","Agent authority or configuration is unavailable.");const remaining=await storage.getRun(scope.runId);return remaining?.attempts.some(item=>["starting","waiting_provider"].includes(item.status))?{state:"pending" as const,retryAfterMs:1000}:{state:"failed" as const,safeMessage:"Agent authority or configuration is unavailable."}
 }
}
