import type {ConnectionDefinition} from "./workflow-connection-definitions.ts";import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";
export type VersionedConnectionDefinition={definition:ConnectionDefinition;fileSha:string};
export function vaultReferenceAtRevision(current:VersionedConnectionDefinition,expectedRevision:string){if(current.fileSha!==expectedRevision)throw new Error("connection_revision_conflict");if(!current.definition.credential||!("source" in current.definition.credential)||current.definition.credential.source!=="adt-vault")throw new Error("credential_source_invalid");return current.definition.credential.secretRef}
export async function mutateVaultCredential(current:VersionedConnectionDefinition,expectedRevision:string,vault:Pick<D1ProviderCredentialVault,"recover"|"replace"|"delete">,operation:"recover"|"replace"|"delete",credential?:string){const ref=vaultReferenceAtRevision(current,expectedRevision);if(operation==="delete")await vault.delete(ref);else if(credential!==undefined)await vault[operation](ref,credential);else throw new Error("credential_required");return ref}

export async function recoverConnectionCredential(
 current:VersionedConnectionDefinition,expectedRevision:string,credential:string,
 vault:Pick<D1ProviderCredentialVault,"create"|"delete"|"resolve">,
 repository:Pick<import("./workflow-connection-definition-repository.ts").WorkflowConnectionDefinitionRepository,"updateConnection">,
){
 const oldRef=vaultReferenceAtRevision(current,expectedRevision);
 if(!repository.updateConnection)throw Error("connection_repository_unavailable");
 try{await vault.resolve(oldRef);throw Error("vault_secret_exists")}
 catch(error){if(!(error instanceof Error)||error.message!=="vault_secret_unavailable")throw error}
 const secretRef=await vault.create(credential);
 try{
  await repository.updateConnection({...current.definition,credential:{source:"adt-vault",secretRef}},expectedRevision);
 }catch(error){
  if(error instanceof Error&&["connection_revision_conflict","definition_conflict"].includes(error.message))
   await vault.delete(secretRef).catch(()=>undefined);
  throw error;
 }
 return secretRef;
}
