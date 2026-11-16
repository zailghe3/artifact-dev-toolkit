import {GitHubKnowledgeRepository} from "./advisor-knowledge-repository.ts";
import {KnowledgeProposalStore,type KnowledgeActor} from "./advisor-knowledge-proposals.ts";
import {DEFAULT_ARTIFACT_ROOT} from "./artifact-contract.ts";
import {getRepositoryAuthorizationConfig,type RepositoryAccessContext} from "./repository-authorization.ts";
import {getWorkflowEnvironment} from "./workflow-services.ts";
import type {WorkflowD1Database} from "./workflow-d1-storage.ts";
import type {RunRepositoryContext} from "./workflow-storage.ts";
export function knowledgeRepositoryContext(access:RepositoryAccessContext):RunRepositoryContext{
 const config=getRepositoryAuthorizationConfig();
 if(config.owner.toLowerCase()!==access.owner.toLowerCase()||config.repo.toLowerCase()!==access.repo.toLowerCase())throw Error("permission_denied");
 return {repositoryId:access.repositoryId,installationId:access.installationId,owner:access.owner,repository:access.repo,branch:config.branch,root:DEFAULT_ARTIFACT_ROOT};
}
export function createKnowledgeRepository(access:RepositoryAccessContext){return new GitHubKnowledgeRepository(knowledgeRepositoryContext(access),access.installationCredentialProvider)}
export async function createKnowledgeProposalStore(access:RepositoryAccessContext,actor:KnowledgeActor){return new KnowledgeProposalStore((await getWorkflowEnvironment()).AUTH_SESSIONS_DB as unknown as WorkflowD1Database,knowledgeRepositoryContext(access),actor)}
