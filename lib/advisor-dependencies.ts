import {getArtifactWithRevision} from "./artifacts.ts";
import {AGENT_MASTER_PROMPT_MAX_LENGTH,type AgentDefinitionV1} from "./workflow-definitions.ts";
import {freezeSecurityProfiles} from "./security-profile-authority.ts";
import {createSecurityProfileDefinitionRepository,getProviderCredentialVault} from "./workflow-services.ts";
import type {RepositoryAccessContext} from "./repository-authorization.ts";

/** Settings validation performs the same read-only prompt/profile checks as ordinary admission. */
export async function validateAdvisorDependencies(access:RepositoryAccessContext,agents:readonly AgentDefinitionV1[]){
  await Promise.all(agents.map(async agent=>{
    if(agent.prompt.source!=="artifact")return;
    const resolved=await getArtifactWithRevision(access,agent.prompt.artifactId);
    if(!resolved)throw new Error("prompt_not_found");
    if(resolved.artifact.type!=="prompt")throw new Error("prompt_not_prompt_artifact");
    if(resolved.artifact.body.length>AGENT_MASTER_PROMPT_MAX_LENGTH)throw new Error("prompt_too_large");
  }));
  if(agents.some(agent=>agent.securityProfileId))await freezeSecurityProfiles(access.repositoryId,agents,createSecurityProfileDefinitionRepository(access),await getProviderCredentialVault(access.repositoryId));
}
