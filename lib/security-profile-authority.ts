import {z} from "zod";
import type {AgentDefinitionV1} from "./workflow-definitions.ts";
import type {SecurityProfileDefinitionRepository} from "./security-profile-definition-repository.ts";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";
import type {SecurityProfileDefinition} from "./security-profile-definitions.ts";
import {DefinitionConflictError,DefinitionNotFoundError,type Versioned} from "./workflow-definition-repository.ts";

export const frozenSecurityProfileSchema=z.object({provider:z.literal("adrian"),profileId:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),endpointUrl:z.string().url().refine(value=>new URL(value).protocol==="wss:"),decisionTimeoutMs:z.number().int().min(250).max(30_000),credentialBindingId:z.string().regex(/^spb_[A-Za-z0-9_-]{43}$/)}).strict();
export type FrozenSecurityProfile=z.infer<typeof frozenSecurityProfileSchema>;
export const frozenSecurityProfilesSchema=z.record(z.string(),frozenSecurityProfileSchema);
export type FrozenSecurityProfiles=z.infer<typeof frozenSecurityProfilesSchema>;

export async function freezeSecurityProfiles(repositoryId:number,agents:readonly AgentDefinitionV1[],repository:Pick<SecurityProfileDefinitionRepository,"list">,vault:Pick<D1ProviderCredentialVault,"currentSecurityProfileCredentialBinding">){const profiles=new Map((await repository.list()).map(item=>[item.definition.id,item.definition])),snapshot:FrozenSecurityProfiles={};for(const agent of agents){if(!agent.securityProfileId)continue;const profile=profiles.get(agent.securityProfileId);if(!profile)throw new Error("security_profile_missing");const binding=await vault.currentSecurityProfileCredentialBinding(repositoryId,profile.id,profile.endpointUrl);snapshot[agent.id]=frozenSecurityProfileSchema.parse({provider:"adrian",profileId:profile.id,endpointUrl:profile.endpointUrl,decisionTimeoutMs:profile.decisionTimeoutMs,credentialBindingId:binding.bindingId})}return snapshot}
export async function resolveFrozenSecurityProfile(repositoryId:number,agent:AgentDefinitionV1,snapshot:FrozenSecurityProfiles|undefined,vault:Pick<D1ProviderCredentialVault,"resolveSecurityProfileCredential">){if(!agent.securityProfileId)return undefined;const frozen=snapshot?.[agent.id];if(!frozen||frozen.profileId!==agent.securityProfileId)throw new Error("security_profile_snapshot_missing");return{provider:"adrian" as const,profileId:frozen.profileId,endpointUrl:frozen.endpointUrl,decisionTimeoutMs:frozen.decisionTimeoutMs,credential:await vault.resolveSecurityProfileCredential(repositoryId,frozen.credentialBindingId,frozen.endpointUrl)}}


type ProfileMutationRepository=Pick<SecurityProfileDefinitionRepository,"get"|"update">;
type ProfileMutationVault=Pick<D1ProviderCredentialVault,"currentSecurityProfileCredentialBinding"|"createSecurityProfileCredentialBinding"|"rotateSecurityProfileCredential"|"replaceSecurityProfileCredentialBinding">;
/** One revision-checked Git mutation followed by a compensated credential-authority transition. */
export async function updateSecurityProfileAuthority(repositoryId:number,definition:SecurityProfileDefinition,fileSha:string,apiKey:string|undefined,repository:ProfileMutationRepository,vault:ProfileMutationVault):Promise<Versioned<SecurityProfileDefinition>>{
 const old=await repository.get(definition.id);if(!old)throw new DefinitionNotFoundError();if(old.fileSha!==fileSha)throw new DefinitionConflictError();
 let binding:{bindingId:string}|undefined;try{binding=await vault.currentSecurityProfileCredentialBinding(repositoryId,definition.id,old.definition.endpointUrl)}catch{}
 if(!binding&&(!apiKey||definition.endpointUrl!==old.definition.endpointUrl))throw new Error("security_profile_credential_required");
 if(binding&&old.definition.endpointUrl!==definition.endpointUrl&&!apiKey)throw new Error("security_profile_credential_required");
 const saved=await repository.update(definition,fileSha);
 try{
  if(!binding)await vault.createSecurityProfileCredentialBinding(repositoryId,definition.id,saved.definition.endpointUrl,apiKey!);
  else if(old.definition.endpointUrl!==saved.definition.endpointUrl)await vault.replaceSecurityProfileCredentialBinding(repositoryId,definition.id,binding.bindingId,old.definition.endpointUrl,saved.definition.endpointUrl,apiKey!);
  else if(apiKey)await vault.rotateSecurityProfileCredential(repositoryId,definition.id,binding.bindingId,saved.definition.endpointUrl,apiKey);
  return saved;
 }catch(error){await repository.update(old.definition,saved.fileSha).catch(()=>undefined);throw error}
}
