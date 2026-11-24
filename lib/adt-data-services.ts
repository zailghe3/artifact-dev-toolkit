import {GitHubKnowledgeRepository} from "./advisor-knowledge-repository.ts";
import {GitHubArtifactRepository} from "./artifact-repository.ts";
import {AdtDataTools} from "./adt-data-tools.ts";
import {GitHubWorkflowDefinitionRepository} from "./workflow-definition-repository.ts";
import {createGitHubAppJwt,getConfiguredRepository,getRepositoryInstallation,mintInstallationToken} from "./github-app.ts";
import {DEFAULT_ARTIFACT_ROOT} from "./artifact-contract.ts";
import type {RunRepositoryContext} from "./workflow-storage.ts";
import type {WorkflowD1Database} from "./workflow-d1-storage.ts";
import type {AdtDataTool} from "./adt-data-contract.ts";

export type NativeAdtDataAccess={authorize:(context:RunRepositoryContext)=>Promise<void>;execute:(name:AdtDataTool,input:unknown,context:RunRepositoryContext)=>Promise<unknown>};
export function createNativeAdtDataAccess(db:WorkflowD1Database,secrets:Record<string,string>,credentialFor=(context:RunRepositoryContext)=>authorizeAdtDataContext(context,secrets)):NativeAdtDataAccess{
  return {authorize:async context=>{await credentialFor(context)},execute:async(name,input,context)=>{
    const credential=await credentialFor(context);
    const result=await createAdtDataTools(context,db,credential.token).execute(name,input,context);
    if(Buffer.byteLength(JSON.stringify(result))>128000)throw new Error("adt_data_result_too_large");
    return result;
  }};
}

/** Revalidate the configured trust target at each callback, before minting scoped GitHub access. */
export async function authorizeAdtDataContext(context:RunRepositoryContext,secrets:Record<string,string>,fetcher:typeof fetch=fetch){
  if(context.owner.toLowerCase()!==secrets.GITHUB_ARTIFACT_REPOSITORY_OWNER?.toLowerCase()||context.repository.toLowerCase()!==secrets.GITHUB_ARTIFACT_REPOSITORY_NAME?.toLowerCase()||context.branch!==(secrets.GITHUB_ARTIFACT_REPOSITORY_BRANCH??"main")||context.root!==DEFAULT_ARTIFACT_ROOT)throw new Error("permission_denied");
  const config={owner:context.owner,repo:context.repository},jwt=await createGitHubAppJwt(secrets.GITHUB_APP_ID,secrets.GITHUB_APP_PRIVATE_KEY),installation=await getRepositoryInstallation(config,jwt,fetcher);
  if(installation.id!==context.installationId)throw new Error("permission_denied");
  const credential=await mintInstallationToken(context.installationId,context.repositoryId,jwt,"read",fetcher),repository=await getConfiguredRepository(config,credential.token,fetcher);
  if(repository.id!==context.repositoryId)throw new Error("permission_denied");
  return credential;
}
export function createAdtDataTools(context:RunRepositoryContext,db:WorkflowD1Database,token:string){
  const definitions=new GitHubWorkflowDefinitionRepository(async(path,init)=>{
    if(init?.method&&init.method!=="GET")throw new Error("permission_denied");
    const url=new URL(`https://api.github.com/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repository)}${path}`);url.searchParams.set("ref",context.branch);
    return fetch(url,{headers:{accept:"application/vnd.github+json",authorization:`Bearer ${token}`,"user-agent":"artifact-dev-toolkit"},redirect:"error"});
  });
  const credential=async()=>({token,permissions:{contents:"read" as const},expiresAt:new Date(Date.now()+60000).toISOString()});
  const knowledge=new GitHubKnowledgeRepository(context,credential);
  const artifacts=new GitHubArtifactRepository({owner:context.owner,repo:context.repository,branch:context.branch,rootPath:context.root,credentialProvider:credential});
  return new AdtDataTools(db,definitions,knowledge,async id=>{const result=await artifacts.findByIdWithRevision(id);return result?.artifact.type==="prompt"?{body:result.artifact.body,path:result.artifact.path,revision:result.currentFileSha}:undefined});
}
