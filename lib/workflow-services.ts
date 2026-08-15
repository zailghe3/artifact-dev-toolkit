import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RepositoryAccessContext } from "./repository-authorization.ts";
import { GitHubWorkflowDefinitionRepository } from "./workflow-definition-repository.ts";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";
import {D1WorkflowProviderConnectionStore,type ProviderConnectionDatabase} from "./workflow-provider-connection-store.ts";
import {listConnectionDescriptors,codexRunnerDescriptor} from "./workflow-connections.ts";
import {D1WorkflowCodexEnvironmentStore} from "./workflow-codex-environment-store.ts";
import {getCodexRunnerClient} from "./codex-runner-client.ts";
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

export async function readCodexRunnerCatalog(){try{const client=getCodexRunnerClient();const [capabilities,environments,models]=await Promise.all([client.capabilities(),client.environments(),client.models()]);return{available:capabilities.codexAvailable&&capabilities.jobExecution&&environments.some(item=>item.enabled&&item.ready),environments,models}}catch{return{available:false,environments:[],models:[]}}}
export async function listWorkflowConnectionDescriptors(){const [catalog,providers]=await Promise.all([readCodexRunnerCatalog(),getWorkflowProviderConnectionStore().then(store=>store.listSafeDescriptors())]);return[...listConnectionDescriptors().map(item=>item.key==="codex-primary"?codexRunnerDescriptor(catalog.available):item),...providers];}
export async function validateCodexRunnerAgentOptions(options:unknown){const {codexRunnerOptionsSchema}=await import("./workflow-adapter.ts"),parsed=codexRunnerOptionsSchema.parse(options),catalog=await readCodexRunnerCatalog();if(!catalog.available)throw new Error("connection_unavailable");const environment=catalog.environments.find(item=>item.key===parsed.environmentKey);if(!environment?.enabled||!environment.ready)throw new Error("codex_environment_unavailable");const model=parsed.model?catalog.models.find(item=>item.id===parsed.model):catalog.models.find(item=>item.isDefault);if(parsed.model&&!model)throw new Error("codex_model_unavailable");if(parsed.reasoningEffort&&(!model||!model.supportedReasoningEfforts.some(item=>item.reasoningEffort===parsed.reasoningEffort)))throw new Error("codex_reasoning_effort_unavailable");return parsed}
