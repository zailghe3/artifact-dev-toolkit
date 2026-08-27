import {connectionDefinitionPath,connectionDefinitionSchema,type ConnectionDefinition} from "./workflow-connection-definitions.ts";
import {assertProviderConnectionKey} from "./workflow-connections.ts";
import type {WorkflowConnectionDefinitionRepository} from "./workflow-connection-definition-repository.ts";
import type {D1WorkflowProviderConnectionStore,LegacyConnectionMigrationSource} from "./workflow-provider-connection-store.ts";
import type {WorkflowProviderSecretResolver} from "./workflow-provider-secret-resolver.ts";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";

export type ConnectionMigrationState="d1_eligible"|"git_binding_eligible"|"git_binding_unavailable"|"already_vault"|"temporarily_unavailable";
export type ConnectionMigration={connectionId:string;connectionName:string;runtime:string;configuredModel:string;targetPath:string;currentSource:"legacy-d1"|"cloudflare-binding"|"adt-vault";targetSource:"adt-vault";state:ConnectionMigrationState;message:string;repositoryRevision?:string;sourceVersion?:string;canMigrate:boolean};
export type ConnectionMigrationRequest={expectedSource:"legacy-d1"|"cloudflare-binding";repositoryRevision?:string;sourceVersion?:string};

const messages:Record<ConnectionMigrationState,string>={
 d1_eligible:"Legacy D1 is active and ready for server-side migration to Git and the ADT vault.",
 git_binding_eligible:"The active legacy Cloudflare provider binding is ready for server-side migration to the ADT vault.",
 git_binding_unavailable:"The active Cloudflare binding is unavailable. Re-enter the credential with Switch to ADT vault.",
 already_vault:"This connection already uses the ADT vault.",
 temporarily_unavailable:"Migration state could not be established safely. Refresh before taking another action.",
};

export class ConnectionMigrationError extends Error{code:string;constructor(code:string){super(code);this.code=code}}

function view(definition:ConnectionDefinition,state:ConnectionMigrationState,currentSource:ConnectionMigration["currentSource"],extra:Partial<ConnectionMigration>={}):ConnectionMigration{return{connectionId:definition.id,connectionName:definition.name,runtime:definition.runtime,configuredModel:definition.model,targetPath:connectionDefinitionPath(definition.id),currentSource,targetSource:"adt-vault",state,message:messages[state],canMigrate:state==="d1_eligible"||state==="git_binding_eligible",...extra}}
function d1Definition(source:LegacyConnectionMigrationSource,secretRef:string){return connectionDefinitionSchema.parse({schemaVersion:1,id:source.descriptor.key,name:source.descriptor.name,runtime:"openai-responses",provider:"openai",model:source.descriptor.defaultModel,credential:{source:"adt-vault",secretRef}})}
function definiteConflict(error:unknown){return error instanceof Error&&(error.message==="connection_revision_conflict"||error.message==="connection_exists")}

export class WorkflowProviderConnectionMigrationService{
 private git:WorkflowConnectionDefinitionRepository;private d1:D1WorkflowProviderConnectionStore;private secrets:WorkflowProviderSecretResolver;private vault:Pick<D1ProviderCredentialVault,"create"|"delete">;
 constructor(git:WorkflowConnectionDefinitionRepository,d1:D1WorkflowProviderConnectionStore,secrets:WorkflowProviderSecretResolver,vault:Pick<D1ProviderCredentialVault,"create"|"delete">){this.git=git;this.d1=d1;this.secrets=secrets;this.vault=vault}

 async inspect(connectionId:string):Promise<ConnectionMigration>{
  assertProviderConnectionKey(connectionId);
  let git;try{git=await this.git.getConnection(connectionId)}catch{return{connectionId,connectionName:connectionId,runtime:"unknown",configuredModel:"unknown",targetPath:connectionDefinitionPath(connectionId),currentSource:"legacy-d1",targetSource:"adt-vault",state:"temporarily_unavailable",message:messages.temporarily_unavailable,canMigrate:false}}
  if(git){
   if("source" in git.definition.credential)return view(git.definition,"already_vault","adt-vault",{repositoryRevision:git.fileSha});
   try{this.secrets.resolve(git.definition.credential.secretRef);return view(git.definition,"git_binding_eligible","cloudflare-binding",{repositoryRevision:git.fileSha})}
   catch{return view(git.definition,"git_binding_unavailable","cloudflare-binding",{repositoryRevision:git.fileSha})}
  }
  const source=await this.d1.getLegacyMigrationSource(connectionId).catch(()=>undefined);
  if(!source)throw new ConnectionMigrationError("migration_source_not_found");
  const definition=connectionDefinitionSchema.parse({schemaVersion:1,id:source.descriptor.key,name:source.descriptor.name,runtime:"openai-responses",provider:"openai",model:source.descriptor.defaultModel,credential:{source:"adt-vault",secretRef:`sec_${"x".repeat(43)}`}});
  return view(definition,"d1_eligible","legacy-d1",{sourceVersion:source.sourceVersion});
 }

 async migrate(connectionId:string,expected:ConnectionMigrationRequest):Promise<{state:"completed";connectionId:string;repositoryRevision?:string}>{
  assertProviderConnectionKey(connectionId);
  const current=await this.git.getConnection(connectionId).catch(()=>{throw new ConnectionMigrationError("migration_repository_unavailable")});
  if(current&&"source" in current.definition.credential)return{state:"completed",connectionId,repositoryRevision:current.fileSha};
  if(expected.expectedSource==="cloudflare-binding"){
   if(!current||!expected.repositoryRevision||current.fileSha!==expected.repositoryRevision||"source" in current.definition.credential)throw new ConnectionMigrationError("migration_source_changed");
   let credential:string;try{credential=this.secrets.resolve(current.definition.credential.secretRef)}catch{throw new ConnectionMigrationError("migration_credential_unavailable")}
   if(!this.git.updateConnection)throw new ConnectionMigrationError("migration_repository_unavailable");
   const secretRef=await this.vault.create(credential),definition=connectionDefinitionSchema.parse({...current.definition,credential:{source:"adt-vault",secretRef}});
   try{const result=await this.git.updateConnection(definition,expected.repositoryRevision);return{state:"completed",connectionId,repositoryRevision:result.fileSha}}
   catch(error){if(definiteConflict(error))await this.vault.delete(secretRef);throw error}
  }
  if(current||!expected.sourceVersion)throw new ConnectionMigrationError("migration_source_changed");
  const source=await this.d1.getLegacyMigrationSource(connectionId).catch(()=>{throw new ConnectionMigrationError("migration_credential_unavailable")});
  if(!source||source.sourceVersion!==expected.sourceVersion)throw new ConnectionMigrationError("migration_source_changed");
  if(await this.git.getConnection(connectionId))throw new ConnectionMigrationError("migration_source_changed");
  if(!this.git.createConnection)throw new ConnectionMigrationError("migration_repository_unavailable");
  const secretRef=await this.vault.create(source.credential),definition=d1Definition(source,secretRef);
  try{const result=await this.git.createConnection(definition);return{state:"completed",connectionId,repositoryRevision:result.fileSha}}
  catch(error){if(definiteConflict(error))await this.vault.delete(secretRef);throw error}
 }
}
