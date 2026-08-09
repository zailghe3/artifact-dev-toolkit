import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RepositoryAccessContext } from "./repository-authorization.ts";
import { GitHubWorkflowDefinitionRepository } from "./workflow-definition-repository.ts";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";
import {D1WorkflowProviderConnectionStore,type ProviderConnectionDatabase} from "./workflow-provider-connection-store.ts";
import {listConnectionDescriptors} from "./workflow-connections.ts";
import {D1WorkflowCodexEnvironmentStore} from "./workflow-codex-environment-store.ts";
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

export async function listWorkflowConnectionDescriptors(){return[...listConnectionDescriptors(),...await(await getWorkflowProviderConnectionStore()).listSafeDescriptors()];}
