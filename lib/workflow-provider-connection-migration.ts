import {connectionDefinitionPath,connectionDefinitionSchema,PROVIDER_CONNECTION_SECRET_PREFIX,SECRET_BINDING,type ConnectionDefinition} from "./workflow-connection-definitions.ts";
import {assertProviderConnectionKey} from "./workflow-connections.ts";
import type {WorkflowConnectionDefinitionRepository} from "./workflow-connection-definition-repository.ts";
import type {D1WorkflowProviderConnectionStore} from "./workflow-provider-connection-store.ts";
import type {WorkflowProviderSecretResolver} from "./workflow-provider-secret-resolver.ts";

export type ConnectionMigrationState="d1_only"|"git_secret_missing"|"git_validation_failed"|"git_ready_shadowing_d1"|"git_ready"|"git_d1_mismatch"|"temporarily_unavailable";
export type ConnectionMigration={connectionId:string;connectionName:string;configuredModel:string;targetPath:string;definition:ConnectionDefinition;canonicalJson:string;secretRef:string;secretProvisioning:"external_required"|"resolved";state:ConnectionMigrationState;message:string;repositoryRevision?:string;canRetire:boolean};

const messages:Record<ConnectionMigrationState,string>={
 d1_only:"D1 is active. Prepare the Git definition and provision its provider secret separately.",
 git_secret_missing:"Git is authoritative, but the required provider secret is not available.",
 git_validation_failed:"Git is authoritative, but live credential and model validation did not succeed.",
 git_ready_shadowing_d1:"Git is live-ready and shadows a matching D1 fallback row.",
 git_ready:"Git is live-ready and no D1 fallback row remains.",
 git_d1_mismatch:"Git is authoritative, but its safe configuration does not match the D1 migration source.",
 temporarily_unavailable:"Migration readiness could not be checked because the repository or provider is temporarily unavailable.",
};

export class ConnectionMigrationError extends Error{code:string;constructor(code:string){super(code);this.code=code}}

export function suggestedProviderSecretRef(connectionId:string){
 const value=`${PROVIDER_CONNECTION_SECRET_PREFIX}${connectionId.toUpperCase().replaceAll("-","_")}`;
 if(!SECRET_BINDING.test(value))throw new ConnectionMigrationError("migration_secret_ref_invalid");
 return value;
}

export function createConnectionMigrationExport(value:{key:string;name:string;adapter:string;defaultModel?:string}){
 if(value.adapter!=="openai-responses"||!value.defaultModel)throw new ConnectionMigrationError("migration_source_not_found");
 assertProviderConnectionKey(value.key);
 const secretRef=suggestedProviderSecretRef(value.key),definition=connectionDefinitionSchema.parse({schemaVersion:1,id:value.key,name:value.name,runtime:"openai-responses",provider:"openai",model:value.defaultModel,credential:{secretRef}});
 return{connectionId:value.key,connectionName:value.name,configuredModel:value.defaultModel,targetPath:connectionDefinitionPath(value.key),definition,canonicalJson:`${JSON.stringify(definition,null,2)}\n`,secretRef};
}

function equivalent(d1:{key:string;name:string;adapter:string;defaultModel?:string},git:ConnectionDefinition){return d1.key===git.id&&d1.adapter===git.runtime&&d1.defaultModel===git.model&&d1.name.trim()===git.name.trim()}

export class WorkflowProviderConnectionMigrationService{
 private git:WorkflowConnectionDefinitionRepository;private d1:D1WorkflowProviderConnectionStore;private secrets:WorkflowProviderSecretResolver;private validateModel:(credential:string,model:string)=>Promise<void>;
 constructor(git:WorkflowConnectionDefinitionRepository,d1:D1WorkflowProviderConnectionStore,secrets:WorkflowProviderSecretResolver,validateModel:(credential:string,model:string)=>Promise<void>){this.git=git;this.d1=d1;this.secrets=secrets;this.validateModel=validateModel}
 async inspect(connectionId:string):Promise<ConnectionMigration>{
  assertProviderConnectionKey(connectionId);
  const d1=await this.d1.getPersistedSafeDescriptor(connectionId),git=await this.git.getConnection(connectionId).catch(()=>{throw new ConnectionMigrationError("migration_repository_unavailable")});
  if(!d1&&!git)throw new ConnectionMigrationError("migration_source_not_found");
  const base=createConnectionMigrationExport(d1??{key:git!.definition.id,name:git!.definition.name,adapter:git!.definition.runtime,defaultModel:git!.definition.model});
  if(!git)return{...base,secretProvisioning:"external_required",state:"d1_only",message:messages.d1_only,canRetire:false};
  const current={...base,definition:git.definition,canonicalJson:`${JSON.stringify(git.definition,null,2)}\n`,secretRef:git.definition.credential.secretRef,targetPath:connectionDefinitionPath(git.definition.id),repositoryRevision:git.fileSha};
  if(d1&&!equivalent(d1,git.definition))return{...current,secretProvisioning:"external_required",state:"git_d1_mismatch",message:messages.git_d1_mismatch,canRetire:false};
  let credential:string;try{credential=this.secrets.resolve(git.definition.credential.secretRef)}catch{return{...current,secretProvisioning:"external_required",state:"git_secret_missing",message:messages.git_secret_missing,canRetire:false}}
  try{await this.validateModel(credential,git.definition.model)}catch(error){const transient=error instanceof Error&&["provider_unavailable","provider_timeout","rate_limited"].includes(error.message);const state=transient?"temporarily_unavailable":"git_validation_failed";return{...current,secretProvisioning:"resolved",state,message:messages[state],canRetire:false}}
  const state=d1?"git_ready_shadowing_d1":"git_ready";return{...current,secretProvisioning:"resolved",state,message:messages[state],canRetire:!!d1};
 }
 async retire(connectionId:string,reviewedRevision:string){
  const migration=await this.inspect(connectionId);
  if(!migration.repositoryRevision||migration.repositoryRevision!==reviewedRevision)throw new ConnectionMigrationError("migration_stale_revision");
  if(migration.state!=="git_ready_shadowing_d1"||!migration.canRetire)throw new ConnectionMigrationError(migration.state==="git_d1_mismatch"?"migration_configuration_mismatch":"migration_not_ready");
  await this.d1.retirePersistedConnection({key:migration.definition.id,name:migration.definition.name,adapter:migration.definition.runtime,defaultModel:migration.definition.model});
  return this.inspect(connectionId);
 }
}
