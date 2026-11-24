import {NextResponse} from "next/server";
import type {RepositoryAccessContext} from "./repository-authorization.ts";
import {DEFAULT_ARTIFACT_ROOT} from "./artifact-contract.ts";
import {applyAdvisorOverride,assertAdvisorReadOnly,assertAdvisorRunReadOnly,sameRepositoryContext,type AdvisorSettings} from "./advisor-policy.ts";
import {getProviderConnectionType} from "./provider-connection-types.ts";
import type {ConnectionDescriptor} from "./workflow-connections.ts";
import {newLangGraphWorkflowRun,type WorkflowRun} from "./workflow-storage.ts";
import {validateWorkflowRunAdmissionSources,validateAgentConnectionOptions,workflowAgentReferences,compileWorkflowV2ExecutionPlan,composeVersionedWorkflowV2,AGENT_MASTER_PROMPT_MAX_LENGTH} from "./workflow-definitions.ts";
import {resolveWorkflowRunConnectionSnapshot} from "./workflow-run-connection-snapshots.ts";
import * as services from "./workflow-services.ts";
import {workflowError} from "./workflow-http.ts";
import {getArtifactWithRevision} from "./artifacts.ts";
import {freezeSecurityProfiles} from "./security-profile-authority.ts";
import {freezeAuthorizedMcpTools} from "./mcp-tool-authority.ts";
import {noStoreHeaders} from "./auth-core.ts";

export type WorkflowStartInput={workflowId:string;initialInput:string;idempotencyKey:string};
const defaults={...services,getArtifactWithRevision};
type Dependencies=Partial<typeof defaults>;
export function assertWorkflowReplay(run:WorkflowRun,access:RepositoryAccessContext,body:WorkflowStartInput,advisor?:AdvisorSettings){
  const context={repositoryId:access.repositoryId,installationId:access.installationId,owner:access.owner,repository:access.repo,branch:process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH??"main",root:DEFAULT_ARTIFACT_ROOT};
  if(!sameRepositoryContext(run.repositoryContext,context)||run.initialInput!==body.initialInput||run.workflowId!==body.workflowId||Boolean(run.advisorContext)!==Boolean(advisor))throw new Error("workflow_idempotency_conflict");
  assertAdvisorRunReadOnly(run);
}
export async function validateAdvisorOverrideModel(settings:AdvisorSettings,identities:readonly ConnectionDescriptor[],access:RepositoryAccessContext,dependencies:Dependencies={}){
  if(!settings.override)return;
  const descriptor=identities.find(item=>item.key===settings.override!.connectionKey);
  if(!descriptor||!descriptor.enabled||!getProviderConnectionType(descriptor.adapter)?.capabilities.agentTools||descriptor.management!=="git")throw new Error("advisor_provider_incompatible");
  const service={...defaults,...dependencies},store=await service.getWorkflowProviderConnectionStore(access),resolved=await store.resolveForExecution(descriptor.key,descriptor);
  await (await service.getProviderModelService()).validate(descriptor.adapter,resolved.credential,settings.override.model,descriptor.providerConfiguration);
}
/** Shared ordinary Workflow admission, snapshotting and durable launch for every entry point. */
export async function launchWorkflowRun(access:RepositoryAccessContext,body:WorkflowStartInput,advisor?:AdvisorSettings,dependencies:Dependencies={}){
  const service={...defaults,...dependencies};
  try{
    const storage=await service.getWorkflowRunStorage(access.repositoryId),existing=await storage.findRunByIdempotencyKey(body.idempotencyKey);
    if(existing){
      assertWorkflowReplay(existing.run,access,body,advisor);
      return NextResponse.json({runId:existing.run.id,url:`/workflows/runs/${existing.run.id}`,launchState:"accepted"},{status:200,headers:noStoreHeaders});
    }
    const repo=service.createWorkflowDefinitionRepository(access),allWorkflows=await repo.listWorkflows(),versioned=allWorkflows.find(item=>item.definition.id===body.workflowId);
    if(!versioned)throw new Error(advisor?"advisor_workflow_invalid":"missing_workflow");
    const composed=composeVersionedWorkflowV2(versioned,allWorkflows),definition=composed.workflow;
    const versions=await Promise.all(workflowAgentReferences(definition).map(agentId=>repo.getAgent(agentId)));
    if(versions.some(item=>!item))throw new Error("missing_agent");
    let agents=versions.map(item=>item!);
    const catalog=advisor?undefined:await service.readCodexRunnerCatalog(access.repositoryId);
    let identities=advisor?await service.listWorkflowConnectionIdentityDescriptors(access):await service.listWorkflowConnectionDescriptors(catalog,access);
    if(advisor){
      if(advisor.workflowId!==body.workflowId)throw new Error("advisor_workflow_invalid");
      const effective=applyAdvisorOverride(agents.map(item=>item.definition),identities,advisor.override);
      agents=agents.map((item,index)=>({...item,definition:effective.agents[index]}));identities=effective.connections;
      assertAdvisorReadOnly(compileWorkflowV2ExecutionPlan(definition,effective.agents),effective.agents,identities);
    }
    const available=identities.filter(item=>item.enabled);
    const plan=await validateWorkflowRunAdmissionSources(definition,agents.map(item=>item.definition),identities,new Set(available.map(item=>item.key)),new Set((catalog?.environments??[]).filter(item=>item.enabled&&item.ready&&item.managedRepository===true).map(item=>item.key)),Boolean(advisor));
    if(advisor)await validateAdvisorOverrideModel(advisor,identities,access,dependencies);
    const validated=await Promise.all(agents.map(async item=>{
      const descriptor=available.find(connection=>connection.key===item.definition.connectionKey)!;
      let agent=validateAgentConnectionOptions(item.definition,descriptor);
      if(agent.prompt.source==="artifact"){
        const resolved=await service.getArtifactWithRevision(access,agent.prompt.artifactId);
        if(!resolved)throw new Error("prompt_not_found");
        if(resolved.artifact.type!=="prompt")throw new Error("prompt_not_prompt_artifact");
        if(resolved.artifact.body.length>AGENT_MASTER_PROMPT_MAX_LENGTH)throw new Error("prompt_too_large");
        agent={...agent,masterPrompt:resolved.artifact.body};
      }
      return {...item,definition:agent};
    }));
    const managedCodeRepositoryContexts=Object.fromEntries(await Promise.all(validated.filter(item=>available.find(connection=>connection.key===item.definition.connectionKey)?.adapter==="codex-runner"&&(item.definition.adapterOptions as {managedGit?:boolean}).managedGit===true).map(async item=>{
      const environmentKey=(item.definition.adapterOptions as {environmentKey:string}).environmentKey;
      return [item.definition.id,await service.resolveManagedCodeRepository(environmentKey,access.repositoryId)];
    })));
    const vault=await service.getProviderCredentialVault(access.repositoryId);
    const mcpToolSnapshots=await freezeAuthorizedMcpTools(access.repositoryId,validated.map(item=>item.definition),service.createToolDefinitionRepository(access),vault,await service.getMcpPolicyAuthority(access.repositoryId));
    const securityProfileSnapshots=await freezeSecurityProfiles(access.repositoryId,validated.map(item=>item.definition),service.createSecurityProfileDefinitionRepository(access),vault);
    const providerStore=await service.getWorkflowProviderConnectionStore(access);
    const connections=await Promise.all([...new Set(validated.map(item=>item.definition.connectionKey))].map(key=>resolveWorkflowRunConnectionSnapshot(available.find(connection=>connection.key===key)!,providerStore)));
    const created=await storage.createRun(newLangGraphWorkflowRun({
      id:crypto.randomUUID(),revision:versioned.fileSha,workflow:versioned.definition,compositionSnapshot:composed.composition,
      executionPlan:plan,
      agents:validated.map(item=>item.definition),agentRevisions:Object.fromEntries(validated.map(item=>[item.definition.id,item.fileSha])),connections,mcpToolSnapshots,securityProfileSnapshots,managedCodeRepositoryContexts,
      repositoryContext:{repositoryId:access.repositoryId,installationId:access.installationId,owner:access.owner,repository:access.repo,branch:process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH??"main",root:DEFAULT_ARTIFACT_ROOT},
      initialInput:body.initialInput,clientIdempotencyKey:body.idempotencyKey,
      ...(advisor?{advisorContext:{version:1,readOnly:true,override:advisor.override}}:{}),
    }));
    // Concurrent idempotency collisions must not attach a different execution.
    assertWorkflowReplay(created.run,access,body,advisor);
    return NextResponse.json({runId:created.run.id,url:`/workflows/runs/${created.run.id}`,launchState:"accepted"},{status:201,headers:noStoreHeaders});
  }catch(error){return workflowError(error)}
}
