import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RepositoryAccessContext } from "./repository-authorization.ts";
import { GitHubWorkflowDefinitionRepository } from "./workflow-definition-repository.ts";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";
import {D1WorkflowProviderConnectionStore,type ProviderConnectionDatabase} from "./workflow-provider-connection-store.ts";
import {listConnectionDescriptors,codexRunnerDescriptor} from "./workflow-connections.ts";
import {D1WorkflowCodexEnvironmentStore} from "./workflow-codex-environment-store.ts";
import type {RunnerEnvironmentDescriptor,RunnerModelDescriptor} from "./codex-runner-client.ts";
import {createWorkflowAdapterRegistry} from "./openai-responses-adapter.ts";

export function createWorkflowDefinitionRepository(access:RepositoryAccessContext){
 const branch=process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH??"main";
 return new GitHubWorkflowDefinitionRepository(async(path,init)=>{const capability=init?.method&&init.method!=="GET"?"write":"read",credential=await access.installationCredentialProvider(capability);const url=new URL(`https://api.github.com/repos/${encodeURIComponent(access.owner)}/${encodeURIComponent(access.repo)}${path}`);if(!init?.method||init.method==="GET")url.searchParams.set("ref",branch);let body=init?.body;if(init?.method&&init.method!=="GET"&&typeof body==="string"){const value=JSON.parse(body) as Record<string,unknown>;body=JSON.stringify({...value,branch});}return fetch(url,{...init,body,headers:{accept:"application/vnd.github+json",authorization:`Bearer ${credential.token}`,"user-agent":"artifact-dev-toolkit",...init?.headers}});},process.env.WORKFLOW_AGENT_ROOT??"_adt/agents",process.env.WORKFLOW_DEFINITION_ROOT??"_adt/workflows");
}
export async function getWorkflowEnvironment(){const {env}=await getCloudflareContext({async:true});return env as CloudflareEnv;}
export async function getWorkflowRunStorage(){const env=await getWorkflowEnvironment();return new D1WorkflowRunStorage(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database);}
export async function getWorkflowProviderConnectionStore(){const env=await getWorkflowEnvironment();return new D1WorkflowProviderConnectionStore(env.AUTH_SESSIONS_DB as unknown as ProviderConnectionDatabase,env.WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY);}
export async function getWorkflowCodexEnvironmentStore(){const env=await getWorkflowEnvironment();return new D1WorkflowCodexEnvironmentStore(env.AUTH_SESSIONS_DB as never);}
export function getWorkflowAdapterRegistry(){return createWorkflowAdapterRegistry();}

export type CodexRunnerSnapshot={configured:boolean;reachable:boolean;codexAvailable:boolean;jobExecution:boolean;environmentCatalogAvailable:boolean;authenticated:boolean;authStatusAvailable:boolean;modelCatalogAvailable:boolean;available:boolean;environments:RunnerEnvironmentDescriptor[];models:RunnerModelDescriptor[]};
export async function readCodexRunnerCatalog():Promise<CodexRunnerSnapshot>{
 const empty={configured:false,reachable:false,codexAvailable:false,jobExecution:false,environmentCatalogAvailable:false,authenticated:false,authStatusAvailable:false,modelCatalogAvailable:false,available:false,environments:[],models:[]};
 let client:ReturnType<typeof import("./codex-runner-client.ts")["getCodexRunnerClient"]>;
 try{const {getCodexRunnerClient}=await import("./codex-runner-client.ts");client=getCodexRunnerClient()}catch{return empty}
 const [capabilitiesResult,environmentsResult,authResult]=await Promise.allSettled([client.capabilities(),client.environments(),client.authStatus()]);
 const capabilities=capabilitiesResult.status==="fulfilled"?capabilitiesResult.value:undefined,environments=environmentsResult.status==="fulfilled"?environmentsResult.value:[],auth=authResult.status==="fulfilled"?authResult.value:undefined;
 let models:RunnerModelDescriptor[]=[];let modelCatalogAvailable=false;
 if(auth?.connected)try{models=await client.models();modelCatalogAvailable=true}catch{/* Model discovery does not erase a successfully discovered environment catalogue. */}
 const reachable=[capabilitiesResult,environmentsResult,authResult].some(result=>result.status==="fulfilled"),environmentCatalogAvailable=environmentsResult.status==="fulfilled",authenticated=auth?.connected===true,available=Boolean(reachable&&capabilities?.codexAvailable&&capabilities.jobExecution&&environmentCatalogAvailable&&environments.some(item=>item.enabled&&item.ready)&&authenticated&&modelCatalogAvailable);
 return{configured:true,reachable,codexAvailable:capabilities?.codexAvailable===true,jobExecution:capabilities?.jobExecution===true,environmentCatalogAvailable,authenticated,authStatusAvailable:Boolean(auth),modelCatalogAvailable,available,environments,models};
}
export async function listWorkflowConnectionDescriptors(snapshot?:CodexRunnerSnapshot){const [catalog,providers]=await Promise.all([snapshot??readCodexRunnerCatalog(),getWorkflowProviderConnectionStore().then(store=>store.listSafeDescriptors())]);return[...listConnectionDescriptors().map(item=>item.key==="codex-primary"?codexRunnerDescriptor(catalog.available):item),...providers];}
export async function validateCodexRunnerAgentOptions(options:unknown){const {validateCodexRunnerOptionsAgainstSnapshot}=await import("./codex-runner-agent-options.ts");return validateCodexRunnerOptionsAgainstSnapshot(options,await readCodexRunnerCatalog())}
