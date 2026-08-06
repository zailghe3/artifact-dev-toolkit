import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RepositoryAccessContext } from "./repository-authorization.ts";
import { GitHubWorkflowDefinitionRepository } from "./workflow-definition-repository.ts";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";

export function createWorkflowDefinitionRepository(access:RepositoryAccessContext){
 const branch=process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH??"main";
 return new GitHubWorkflowDefinitionRepository(async(path,init)=>{const capability=init?.method==="PUT"?"write":"read",credential=await access.installationCredentialProvider(capability);const url=new URL(`https://api.github.com/repos/${encodeURIComponent(access.owner)}/${encodeURIComponent(access.repo)}${path}`);if(!init?.method||init.method==="GET")url.searchParams.set("ref",branch);let body=init?.body;if(init?.method==="PUT"&&typeof body==="string"){const value=JSON.parse(body) as Record<string,unknown>;body=JSON.stringify({...value,branch});}return fetch(url,{...init,body,headers:{accept:"application/vnd.github+json",authorization:`Bearer ${credential.token}`,"user-agent":"artifact-dev-toolkit",...init?.headers}});},process.env.WORKFLOW_AGENT_ROOT??"_adt/agents",process.env.WORKFLOW_DEFINITION_ROOT??"_adt/workflows");
}
export async function getWorkflowEnvironment(){const {env}=await getCloudflareContext({async:true});return env as CloudflareEnv;}
export async function getWorkflowRunStorage(){const env=await getWorkflowEnvironment();return new D1WorkflowRunStorage(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database);}
