import {GitHubKnowledgeRepository} from "./advisor-knowledge-repository.ts";
import {createHash} from "node:crypto";
import {publishClaimedKnowledge,type KnowledgeProposalStore,type KnowledgeActor} from "./advisor-knowledge-proposals.ts";
import {DEFAULT_ARTIFACT_ROOT} from "./artifact-contract.ts";
import {getRepositoryAuthorizationConfig,type RepositoryAccessContext} from "./repository-authorization.ts";
import {workflowRuntimeCommand} from "./workflow-services.ts";
import type {RunRepositoryContext} from "./workflow-storage.ts";
export function knowledgeRepositoryContext(access:RepositoryAccessContext):RunRepositoryContext{
 const config=getRepositoryAuthorizationConfig();
 if(config.owner.toLowerCase()!==access.owner.toLowerCase()||config.repo.toLowerCase()!==access.repo.toLowerCase())throw Error("permission_denied");
 return {repositoryId:access.repositoryId,installationId:access.installationId,owner:access.owner,repository:access.repo,branch:config.branch,root:DEFAULT_ARTIFACT_ROOT};
}
export function createKnowledgeRepository(access:RepositoryAccessContext){return new GitHubKnowledgeRepository(knowledgeRepositoryContext(access),access.installationCredentialProvider)}
export async function createKnowledgeProposalStore(access:RepositoryAccessContext,actor:KnowledgeActor){
 const scope=knowledgeRepositoryContext(access),sessionActor={...actor,sessionId:createHash("sha256").update(actor.sessionId).digest("hex")};
 const call=<T>(method:"get"|"list"|"save"|"review"|"claim"|"finish",...args:unknown[])=>
  workflowRuntimeCommand<T>({operation:"knowledge",method,scope,repositoryId:access.repositoryId,actor:sessionActor,arguments:args});
 const store:Pick<KnowledgeProposalStore,"get"|"list"|"save"|"review"|"claimPublication"|"finishPublication">={
  get:id=>call("get",id),list:()=>call("list"),save:input=>call("save",input),review:(id,revision)=>call("review",id,revision),
  claimPublication:(id,revision,token)=>call("claim",id,revision,token),finishPublication:(id,result)=>call("finish",id,result),
 };
 const publish:KnowledgeProposalStore["publish"]=(...args)=>publishClaimedKnowledge(store,...args);
 return {...store,publish};
}
