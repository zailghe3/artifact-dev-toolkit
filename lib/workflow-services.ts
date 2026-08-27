import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RepositoryAccessContext } from "./repository-authorization.ts";
import { GitHubWorkflowDefinitionRepository } from "./workflow-definition-repository.ts";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";
import {D1WorkflowProviderConnectionStore,type ProviderConnectionDatabase} from "./workflow-provider-connection-store.ts";
import {listConnectionDescriptors,codexRunnerDescriptor,assertUniqueConnectionDescriptors} from "./workflow-connections.ts";
import {D1WorkflowCodexEnvironmentStore} from "./workflow-codex-environment-store.ts";
import type {RunnerEnvironmentDescriptor,RunnerModelDescriptor} from "./codex-runner-client.ts";
import {createWorkflowAdapterRegistry} from "./agent-runtime.ts";
import {GitHubWorkflowConnectionDefinitionRepository} from "./workflow-connection-definition-repository.ts";
import {GitAuthoritativeWorkflowProviderConnectionStore} from "./git-workflow-provider-connection-store.ts";
import {createWorkflowProviderSecretResolver} from "./workflow-provider-secret-resolver.ts";
import {validateOpenAIModel} from "./openai-models.ts";
import {WorkflowProviderConnectionMigrationService} from "./workflow-provider-connection-migration.ts";
import {RemoteOpenAIAgentsRuntime,type ADTRuntimeConfiguration} from "./adt-runtime-client.ts";
import {D1ProviderCredentialVault,type ProviderCredentialVaultDatabase} from "./provider-credential-vault.ts";
import {providerCredentialVaultV1KeyResolver} from "./provider-credential-vault-crypto.ts";

function githubContentsRequest(access:RepositoryAccessContext){const branch=process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH??"main";return async(path:string,init?:RequestInit)=>{const capability=init?.method&&init.method!=="GET"?"write":"read",credential=await access.installationCredentialProvider(capability);const url=new URL(`https://api.github.com/repos/${encodeURIComponent(access.owner)}/${encodeURIComponent(access.repo)}${path}`);if(!init?.method||init.method==="GET")url.searchParams.set("ref",branch);let body=init?.body;if(init?.method&&init.method!=="GET"&&typeof body==="string"){const value=JSON.parse(body) as Record<string,unknown>;body=JSON.stringify({...value,branch});}return fetch(url,{...init,body,headers:{accept:"application/vnd.github+json",authorization:`Bearer ${credential.token}`,"user-agent":"artifact-dev-toolkit",...init?.headers}});}}

export function createWorkflowDefinitionRepository(access:RepositoryAccessContext){
 return new GitHubWorkflowDefinitionRepository(githubContentsRequest(access),process.env.WORKFLOW_AGENT_ROOT??"_adt/agents",process.env.WORKFLOW_DEFINITION_ROOT??"_adt/workflows");
}
export async function getWorkflowEnvironment(){const {env}=await getCloudflareContext({async:true});return env as CloudflareEnv;}
export async function getWorkflowRunStorage(){const env=await getWorkflowEnvironment();return new D1WorkflowRunStorage(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database);}
export async function getProviderCredentialVault(){const env=await getWorkflowEnvironment();return new D1ProviderCredentialVault(env.AUTH_SESSIONS_DB as unknown as ProviderCredentialVaultDatabase,providerCredentialVaultV1KeyResolver(env.WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY));}
export function createWorkflowConnectionDefinitionRepository(access:RepositoryAccessContext){return new GitHubWorkflowConnectionDefinitionRepository(githubContentsRequest(access))}
export async function getWorkflowProviderConnectionStore(access?:RepositoryAccessContext){const env=await getWorkflowEnvironment(),fallback=new D1WorkflowProviderConnectionStore(env.AUTH_SESSIONS_DB as unknown as ProviderConnectionDatabase,env.WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY);if(!access)return fallback;const secrets=createWorkflowProviderSecretResolver(ref=>(env as unknown as Record<string,unknown>)[ref]),vault=await getProviderCredentialVault();return new GitAuthoritativeWorkflowProviderConnectionStore(createWorkflowConnectionDefinitionRepository(access),fallback,secrets,validateOpenAIModel,vault);}
export async function getWorkflowProviderConnectionMigrationService(access:RepositoryAccessContext){const env=await getWorkflowEnvironment(),fallback=new D1WorkflowProviderConnectionStore(env.AUTH_SESSIONS_DB as unknown as ProviderConnectionDatabase,env.WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY),secrets=createWorkflowProviderSecretResolver(ref=>(env as unknown as Record<string,unknown>)[ref]);return new WorkflowProviderConnectionMigrationService(new GitHubWorkflowConnectionDefinitionRepository(githubContentsRequest(access)),fallback,secrets,await getProviderCredentialVault())}
export async function getWorkflowCodexEnvironmentStore(){const env=await getWorkflowEnvironment();return new D1WorkflowCodexEnvironmentStore(env.AUTH_SESSIONS_DB as never);}
export function getWorkflowAdapterRegistry(){return createWorkflowAdapterRegistry();}
export function adtRuntimeConfiguration(env:Record<string,unknown>):ADTRuntimeConfiguration{return{baseUrl:typeof env.ADT_RUNTIME_BASE_URL==="string"?env.ADT_RUNTIME_BASE_URL:undefined,authSecret:typeof env.ADT_RUNTIME_AUTH_SECRET==="string"?env.ADT_RUNTIME_AUTH_SECRET:undefined,wrappingPublicKey:typeof env.ADT_RUNTIME_WRAPPING_PUBLIC_KEY==="string"?env.ADT_RUNTIME_WRAPPING_PUBLIC_KEY:undefined}}
export async function diagnoseADTRuntime(){const env=await getWorkflowEnvironment();return new RemoteOpenAIAgentsRuntime(adtRuntimeConfiguration(env as unknown as Record<string,unknown>)).diagnose()}

export type CodexRunnerSnapshot={configured:boolean;reachable:boolean;capabilitiesAvailable:boolean;codexAvailable:boolean;jobExecution:boolean;environmentCatalogAvailable:boolean;authenticated:boolean;authStatusAvailable:boolean;modelCatalogAvailable:boolean;available:boolean;environments:RunnerEnvironmentDescriptor[];models:RunnerModelDescriptor[]};
export async function readCodexRunnerCatalog():Promise<CodexRunnerSnapshot>{
 const empty={configured:false,reachable:false,capabilitiesAvailable:false,codexAvailable:false,jobExecution:false,environmentCatalogAvailable:false,authenticated:false,authStatusAvailable:false,modelCatalogAvailable:false,available:false,environments:[],models:[]};
 let client:ReturnType<typeof import("./codex-runner-client.ts")["getCodexRunnerClient"]>;
 try{const {getCodexRunnerClient}=await import("./codex-runner-client.ts");client=getCodexRunnerClient()}catch{return empty}
 const [capabilitiesResult,environmentsResult,authResult]=await Promise.allSettled([client.capabilities(),client.environments(),client.authStatus()]);
 const capabilities=capabilitiesResult.status==="fulfilled"?capabilitiesResult.value:undefined,environments=environmentsResult.status==="fulfilled"?environmentsResult.value:[],auth=authResult.status==="fulfilled"?authResult.value:undefined;
 let models:RunnerModelDescriptor[]=[];let modelCatalogAvailable=false;
 if(auth?.connected)try{models=await client.models();modelCatalogAvailable=true}catch{/* Model discovery does not erase a successfully discovered environment catalogue. */}
 const reachable=[capabilitiesResult,environmentsResult,authResult].some(result=>result.status==="fulfilled"),capabilitiesAvailable=capabilitiesResult.status==="fulfilled",environmentCatalogAvailable=environmentsResult.status==="fulfilled",authenticated=auth?.connected===true,available=Boolean(reachable&&capabilitiesAvailable&&capabilities?.codexAvailable&&capabilities.jobExecution&&environmentCatalogAvailable&&environments.some(item=>item.enabled&&item.ready)&&authenticated&&modelCatalogAvailable);
 return{configured:true,reachable,capabilitiesAvailable,codexAvailable:capabilities?.codexAvailable===true,jobExecution:capabilities?.jobExecution===true,environmentCatalogAvailable,authenticated,authStatusAvailable:Boolean(auth),modelCatalogAvailable,available,environments,models};
}
export async function listWorkflowConnectionDescriptors(snapshot?:CodexRunnerSnapshot,access?:RepositoryAccessContext){const [catalog,providers]=await Promise.all([snapshot??readCodexRunnerCatalog(),getWorkflowProviderConnectionStore(access).then(store=>store.listSafeDescriptors())]);return assertUniqueConnectionDescriptors([...listConnectionDescriptors().map(item=>item.key==="codex-primary"?codexRunnerDescriptor(catalog.available):item),...providers]);}
export async function validateCodexRunnerAgentOptions(options:unknown){const {validateCodexRunnerOptionsAgainstSnapshot}=await import("./codex-runner-agent-options.ts");return validateCodexRunnerOptionsAgainstSnapshot(options,await readCodexRunnerCatalog())}
