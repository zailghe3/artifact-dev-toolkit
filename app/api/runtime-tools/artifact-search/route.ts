import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createArtifactSearchGateway } from "@/lib/artifact-search-gateway";
import { getArtifactsForRepositoryContext } from "@/lib/artifacts";
import { createGitHubAppJwt, mintInstallationToken } from "@/lib/github-app";
import { D1WorkflowRunStorage } from "@/lib/workflow-d1-storage";
import {ArtifactSearchAuthorityBudget} from "@/lib/artifact-search-tool";
import {runtimeExecutionPathGateway} from "@/lib/runtime-execution-path-gateway";
import type {WorkflowD1Database} from "@/lib/workflow-d1-storage";
const budget=new ArtifactSearchAuthorityBudget();

export async function POST(request:Request){const {env}=await getCloudflareContext({async:true}),secrets=env as unknown as Record<string,string>;const diagnostic=request.clone();try{const raw=await diagnostic.json() as {operation?:unknown};if(raw?.operation==="execution-path-diagnostic")return runtimeExecutionPathGateway(request,"artifact-search",secrets.ADT_INTERNAL_AUTHORITY_SECRET,env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database,["SELECT 1 FROM workflow_runs LIMIT 1"])}catch{}const storage=new D1WorkflowRunStorage(env.AUTH_SESSIONS_DB as never),gateway=createArtifactSearchGateway({storage,secret:secrets.ADT_INTERNAL_AUTHORITY_SECRET,budget,loadArtifacts:async context=>getArtifactsForRepositoryContext({ok:true,owner:context.owner,repo:context.repository,login:"runtime-tool",githubId:0,repositoryId:context.repositoryId,installationId:context.installationId,checkedAt:Date.now(),installationCredentialProvider:async capability=>mintInstallationToken(context.installationId,context.repositoryId,await createGitHubAppJwt(secrets.GITHUB_APP_ID,secrets.GITHUB_APP_PRIVATE_KEY),capability)},context)});return gateway(request)}
