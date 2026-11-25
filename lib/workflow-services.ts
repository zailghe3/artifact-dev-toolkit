import { diagnoseRuntimeManagement, RuntimeManagementError, runtimeControl } from "./runtime-service-client.ts";
import { signManagedRepositoryAuthorities } from "./runtime-repository-authority.ts";
import { vaultOperations, runnerOperations, type RuntimeControlCommand } from "../adt-runtime/src/runtime-control-contract.ts";
import type { RunDetail, WorkflowRun } from "./workflow-storage.ts";
import type {McpPolicyAuthority,McpPolicyContext} from "./mcp-policy-authority.ts";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RepositoryAccessContext } from "./repository-authorization.ts";
import { GitHubWorkflowDefinitionRepository } from "./workflow-definition-repository.ts";
import {listConnectionDescriptors,codexRunnerDescriptor,assertUniqueConnectionDescriptors} from "./workflow-connections.ts";
import {codexEnvironmentInputSchema,type CodexEnvironmentDescriptor} from "../adt-runtime/src/operational-settings-contract.ts";
import type {RunnerEnvironmentDescriptor,RunnerModelDescriptor} from "./codex-runner-client.ts";
import {GitHubWorkflowConnectionDefinitionRepository} from "./workflow-connection-definition-repository.ts";
import {runtimeProviderClient,runtimeProviderConnectionStore} from "./runtime-provider-client.ts";
import {RemoteOpenAIAgentsRuntime,requestRuntimeRedeploy,requestRuntimeOperationalSettings,type ADTRuntimeConfiguration} from "./adt-runtime-client.ts";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";

import {GitHubWorkflowLayoutRepository} from "./workflow-layout-repository.ts";
import {DEFAULT_ARTIFACT_ROOT} from "./artifact-contract.ts";
import {resolveManagedCodeRepositoryContext} from "./managed-code-repository.ts";
import {getGitHubAppIdentityConfig} from "./repository-authorization.ts";
import {GitHubToolDefinitionRepository} from "./tool-definition-repository.ts";
import {GitHubSecurityProfileDefinitionRepository} from "./security-profile-definition-repository.ts";

function githubContentsRequest(access:RepositoryAccessContext){const branch=process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH??"main";return async(path:string,init?:RequestInit)=>{const capability=init?.method&&init.method!=="GET"?"write":"read",credential=await access.installationCredentialProvider(capability);const url=new URL(`https://api.github.com/repos/${encodeURIComponent(access.owner)}/${encodeURIComponent(access.repo)}${path}`);if(!init?.method||init.method==="GET")url.searchParams.set("ref",branch);let body=init?.body;if(init?.method&&init.method!=="GET"&&typeof body==="string"){const value=JSON.parse(body) as Record<string,unknown>;body=JSON.stringify({...value,branch});}return fetch(url,{...init,body,headers:{accept:"application/vnd.github+json",authorization:`Bearer ${credential.token}`,"user-agent":"artifact-dev-toolkit",...init?.headers}});}}

export function createWorkflowDefinitionRepository(access:RepositoryAccessContext){
 return new GitHubWorkflowDefinitionRepository(githubContentsRequest(access));
}
export function createToolDefinitionRepository(access:RepositoryAccessContext){return new GitHubToolDefinitionRepository(githubContentsRequest(access));}
export function createSecurityProfileDefinitionRepository(access:RepositoryAccessContext){return new GitHubSecurityProfileDefinitionRepository(githubContentsRequest(access));}
export async function listSafeSecurityProfiles(access:RepositoryAccessContext){const repository=createSecurityProfileDefinitionRepository(access),vault=await getProviderCredentialVault(access.repositoryId);return Promise.all((await repository.list()).map(async item=>{let credentialConfigured=false;try{await vault.currentSecurityProfileCredentialBinding(access.repositoryId,item.definition.id,item.definition.endpointUrl);credentialConfigured=true}catch{}return{...item,definition:{...item.definition,credentialConfigured}}}))}
export function createWorkflowLayoutRepository(access:RepositoryAccessContext){return new GitHubWorkflowLayoutRepository(githubContentsRequest(access));}
export async function getWorkflowEnvironment(){const {env}=await getCloudflareContext({async:true});return env as CloudflareEnv;}
export async function workflowRuntimeCommand<T>(command:RuntimeControlCommand):Promise<T>{
 const env=await getWorkflowEnvironment();
 return runtimeControl(adtRuntimeConfiguration(env as unknown as Record<string,unknown>),command);
}
export async function getWorkflowRunStorage(repositoryId:number){
 const env=await getWorkflowEnvironment(),config=adtRuntimeConfiguration(env as unknown as Record<string,unknown>);
 return {
  getRun:async(runId:string)=>await runtimeControl<RunDetail|null>(config,{operation:"runs.detail",runId,repositoryId})??undefined,
  listRuns:async(limit=25)=>await runtimeControl<WorkflowRun[]>(config,{operation:"runs.list",repositoryId,limit}),
  findRunByIdempotencyKey:async(key:string)=>await runtimeControl<RunDetail|null>(config,{operation:"runs.find",repositoryId,key})??undefined,
  createRun:async(run:WorkflowRun)=>runtimeControl<RunDetail>(config,{operation:"runs.launch",repositoryId,
   snapshot:run as unknown as Record<string,unknown>,publicationAuthorities:await signManagedRepositoryAuthorities(run,env.SESSION_SECRET)}),
 };
}
export async function readWorkflowRunHistory(repositoryId: number, limit: number) {
 try {
  const runs = await (await getWorkflowRunStorage(repositoryId)).listRuns(limit);
  return { status: "available" as const, runs };
 } catch (error) {
  if (error instanceof RuntimeManagementError && ["runtime_unavailable", "runtime_not_configured"].includes(error.message))
   return { status: "unavailable" as const };
  throw error;
 }
}
export async function getProviderCredentialVault(repositoryId:number){
 const config=adtRuntimeConfiguration(await getWorkflowEnvironment() as unknown as Record<string,unknown>);
 return Object.fromEntries(vaultOperations.map(method=>[method,(...parameters:unknown[])=>runtimeControl(config,
  {operation:"vault",method,repositoryId,arguments:parameters})])) as Pick<D1ProviderCredentialVault,(typeof vaultOperations)[number]>;
}
export function createWorkflowConnectionDefinitionRepository(access:RepositoryAccessContext){return new GitHubWorkflowConnectionDefinitionRepository(githubContentsRequest(access))}
export async function getProviderModelService(repositoryId:number){return runtimeProviderClient(repositoryId,workflowRuntimeCommand)}
export async function getWorkflowProviderConnectionStore(access:RepositoryAccessContext){
 return runtimeProviderConnectionStore(createWorkflowConnectionDefinitionRepository(access),await getProviderModelService(access.repositoryId));
}
export async function getWorkflowCodexEnvironmentStore(repositoryId:number){
 const config=adtRuntimeConfiguration(await getWorkflowEnvironment() as unknown as Record<string,unknown>);
 return {
  list:()=>requestRuntimeOperationalSettings(config,{operation:"codex.list",repositoryId},value=>codexEnvironmentInputSchema.array().parse(value)),
  upsert:(environment:CodexEnvironmentDescriptor,idempotencyKey:string)=>requestRuntimeOperationalSettings(config,{operation:"codex.save",repositoryId,environment,idempotencyKey},value=>codexEnvironmentInputSchema.parse(value)),
  remove:(key:string,idempotencyKey:string)=>requestRuntimeOperationalSettings(config,{operation:"codex.delete",repositoryId,idempotencyKey,key:codexEnvironmentInputSchema.shape.key.parse(key)},()=>undefined),
 };
}
export function adtRuntimeConfiguration(env:Record<string,unknown>):ADTRuntimeConfiguration{return{baseUrl:typeof env.ADT_RUNTIME_BASE_URL==="string"?env.ADT_RUNTIME_BASE_URL:undefined,authSecret:typeof env.ADT_RUNTIME_AUTH_SECRET==="string"?env.ADT_RUNTIME_AUTH_SECRET:undefined}}
export async function diagnoseADTRuntime(){const env=await getWorkflowEnvironment();return new RemoteOpenAIAgentsRuntime(adtRuntimeConfiguration(env as unknown as Record<string,unknown>)).diagnose()}
export async function diagnoseADTRuntimeExecutionPath(access:RepositoryAccessContext){
 const config=adtRuntimeConfiguration(await getWorkflowEnvironment() as unknown as Record<string,unknown>);
 return diagnoseRuntimeManagement(config,{
  repositoryId:access.repositoryId,installationId:access.installationId,owner:access.owner,repository:access.repo,
  branch:process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH??"main",root:DEFAULT_ARTIFACT_ROOT,
 });
}
export async function redeployInfrastructure(target:"runtime"|"runner"){const env=await getWorkflowEnvironment();return requestRuntimeRedeploy(adtRuntimeConfiguration(env as unknown as Record<string,unknown>),target)}

export type CodexRunnerSnapshot={configured:boolean;reachable:boolean;capabilitiesAvailable:boolean;codexAvailable:boolean;jobExecution:boolean;environmentCatalogAvailable:boolean;authenticated:boolean;authStatusAvailable:boolean;modelCatalogAvailable:boolean;available:boolean;environments:RunnerEnvironmentDescriptor[];models:RunnerModelDescriptor[]};
export async function readCodexRunnerCatalog(repositoryId:number):Promise<CodexRunnerSnapshot>{
 const empty={configured:false,reachable:false,capabilitiesAvailable:false,codexAvailable:false,jobExecution:false,environmentCatalogAvailable:false,authenticated:false,authStatusAvailable:false,modelCatalogAvailable:false,available:false,environments:[],models:[]};
 let client:Awaited<ReturnType<typeof getRuntimeCodexRunnerClient>>;
 try{client=await getRuntimeCodexRunnerClient(repositoryId)}catch{return empty}
 const [capabilitiesResult,environmentsResult,authResult]=await Promise.allSettled([client.capabilities(),client.environments(),client.authStatus()]);
 const capabilities=capabilitiesResult.status==="fulfilled"?capabilitiesResult.value:undefined,environments=environmentsResult.status==="fulfilled"?environmentsResult.value:[],auth=authResult.status==="fulfilled"?authResult.value:undefined;
 let models:RunnerModelDescriptor[]=[];let modelCatalogAvailable=false;
 if(auth?.connected)try{models=await client.models();modelCatalogAvailable=true}catch{/* Model discovery does not erase a successfully discovered environment catalogue. */}
 const reachable=[capabilitiesResult,environmentsResult,authResult].some(result=>result.status==="fulfilled"),capabilitiesAvailable=capabilitiesResult.status==="fulfilled",environmentCatalogAvailable=environmentsResult.status==="fulfilled",authenticated=auth?.connected===true,available=Boolean(reachable&&capabilitiesAvailable&&capabilities?.codexAvailable&&capabilities.jobExecution&&environmentCatalogAvailable&&environments.some(item=>item.enabled&&item.ready)&&authenticated&&modelCatalogAvailable);
 return{configured:true,reachable,capabilitiesAvailable,codexAvailable:capabilities?.codexAvailable===true,jobExecution:capabilities?.jobExecution===true,environmentCatalogAvailable,authenticated,authStatusAvailable:Boolean(auth),modelCatalogAvailable,available,environments,models};
}
export async function resolveManagedCodeRepository(environmentKey:string,repositoryId:number){const client=await getRuntimeCodexRunnerClient(repositoryId),descriptor=await client.managedRepository(environmentKey);return resolveManagedCodeRepositoryContext(descriptor,getGitHubAppIdentityConfig())}
export async function listWorkflowConnectionDescriptors(snapshot:CodexRunnerSnapshot|undefined,access:RepositoryAccessContext){const [catalog,providers]=await Promise.all([snapshot??readCodexRunnerCatalog(access.repositoryId),getWorkflowProviderConnectionStore(access).then(store=>store.listSafeDescriptors())]);return assertUniqueConnectionDescriptors([...listConnectionDescriptors().map(item=>item.key==="codex-primary"?codexRunnerDescriptor(catalog.available):item),...providers]);}
/** Durable connection identities for definition authoring. This never contacts Codex Runner. */
export async function listWorkflowConnectionIdentityDescriptors(access:RepositoryAccessContext){const providers=await getWorkflowProviderConnectionStore(access).then(store=>store.listSafeDescriptors());return assertUniqueConnectionDescriptors([...listConnectionDescriptors(),...providers]);}
export async function validateCodexRunnerAgentOptions(options:unknown,repositoryId:number){const {validateCodexRunnerOptionsAgainstSnapshot}=await import("./codex-runner-agent-options.ts");return validateCodexRunnerOptionsAgainstSnapshot(options,await readCodexRunnerCatalog(repositoryId))}

export async function getMcpPolicyAuthority(repositoryId:number):Promise<McpPolicyAuthority>{
 const command=<T>(method:Extract<RuntimeControlCommand,{operation:"policy"}>["method"],...args:unknown[])=>
  workflowRuntimeCommand<T>({operation:"policy",method,repositoryId,arguments:args});
 return {
  attestation:async id=>await command<Awaited<ReturnType<McpPolicyAuthority["attestation"]>>|null>("attestation",id)??undefined,
  head:async(_repo,id)=>await command<Awaited<ReturnType<McpPolicyAuthority["head"]>>|null>("head",id)??undefined,
  verify:(_repo,definition)=>command("verify",definition),
  verifyFrozen:(_repo,item,current)=>command("verifyFrozen",item,current),
  begin:(_repo,id,head,recover)=>command("begin",id,head??null,recover??false),
  publish:(_repo,definition,_vault,context,mutationId)=>command("publish",definition,context.actor,mutationId),
  settle:(_repo,id,mutationId,old,restore)=>command("settle",id,mutationId,old??null,restore),
  inspect:(_repo,definition)=>command("inspect",definition),
 };
}
export async function getMcpPolicyContext(actor:string,repositoryId:number):Promise<McpPolicyContext>{
 const env=await getWorkflowEnvironment();
 return {authority:await getMcpPolicyAuthority(repositoryId),actor,environment:env as unknown as Record<string,string|undefined>};
}
export async function safePolicyMcp(repositoryId:number,value:{definition:import("./tool-definitions.ts").McpServerDefinition;fileSha:string}){
 const {safeVersionedMcp}=await import("./mcp-tool-service.ts");
 return {...safeVersionedMcp(value),policyAuthority:await(await getMcpPolicyAuthority(repositoryId)).inspect(repositoryId,value.definition,await getProviderCredentialVault(repositoryId))};
}

export async function getRuntimeCodexRunnerClient(repositoryId:number){
 const {CodexRunnerError}=await import("./codex-runner-client.ts");
 type Client=import("./codex-runner-client.ts").CodexRunnerClient;
 type RunnerMethod=typeof runnerOperations[number];
 type Wire<T>={ok:true;result:T}|{ok:false;failure:{category:InstanceType<typeof CodexRunnerError>["category"];transport?:InstanceType<typeof CodexRunnerError>["transport"];runnerCode?:InstanceType<typeof CodexRunnerError>["runnerCode"];details:InstanceType<typeof CodexRunnerError>["details"]}};
 const config=adtRuntimeConfiguration(await getWorkflowEnvironment() as unknown as Record<string,unknown>);
 if(!config.baseUrl||!config.authSecret)throw new CodexRunnerError("configuration_missing");
 return Object.fromEntries(runnerOperations.map(method=>[method,async(...args:(string|number)[])=>{
  const value=await runtimeControl<Wire<unknown>>(config,{operation:"runner",repositoryId,method,arguments:args});
  if(!value.ok){const failure=value.failure;throw new CodexRunnerError(failure.category,failure.transport,failure.runnerCode,failure.details)}
  return value.result;
 }])) as unknown as Pick<Client,RunnerMethod>;
}
