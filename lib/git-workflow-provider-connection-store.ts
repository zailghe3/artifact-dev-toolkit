import {type ConnectionDescriptor,type ResolvedConnection} from "./workflow-connections.ts";
import type {WorkflowConnectionDefinitionRepository} from "./workflow-connection-definition-repository.ts";
import type {WorkflowProviderConnectionStore} from "./workflow-provider-connection-store.ts";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";
import {requireProviderConnectionType,isExecutableGitProviderAdapter} from "./provider-connection-types.ts";

type VersionedConnection=Awaited<ReturnType<WorkflowConnectionDefinitionRepository["listConnections"]>>[number];
export async function resolveGitSnapshotCredential(key:string,snapshot:ConnectionDescriptor,vault?:Pick<D1ProviderCredentialVault,"resolve">):Promise<ResolvedConnection>{if(snapshot.management!=="git"||snapshot.key!==key||snapshot.credentialSource!=="adt-vault"||!snapshot.credentialSecretRef||!vault||!isExecutableGitProviderAdapter(snapshot.adapter))throw new Error("connection_unavailable");try{return{...snapshot,enabled:true,credential:await vault.resolve(snapshot.credentialSecretRef)}}catch{throw new Error("connection_unavailable")}}
export class GitAuthoritativeWorkflowProviderConnectionStore implements WorkflowProviderConnectionStore{
 private git:WorkflowConnectionDefinitionRepository;private validateModel:(credential:string,model:string,connectionType?:string)=>Promise<void>;private vault:Pick<D1ProviderCredentialVault,"resolve">;
 constructor(git:WorkflowConnectionDefinitionRepository,validateModel:(credential:string,model:string,connectionType?:string)=>Promise<void>,vault:Pick<D1ProviderCredentialVault,"resolve">){this.git=git;this.validateModel=validateModel;this.vault=vault;}
 private descriptor(value:VersionedConnection,ready:boolean,configured=ready):ConnectionDescriptor{const type=requireProviderConnectionType(value.definition.runtime);return{key:value.definition.id,name:value.definition.name,adapter:type.id,endpoint:type.endpoint,...(value.definition.model?{defaultModel:value.definition.model}:{}),enabled:ready,configured,management:"git",credentialSource:"adt-vault",credentialSecretRef:value.definition.credential.secretRef,repositoryRevision:value.fileSha,capabilities:type.capabilities}}
 private async safe(value:VersionedConnection){let ready=false,configured=false;try{const resolved=await resolveGitSnapshotCredential(value.definition.id,this.descriptor(value,false),this.vault);configured=true;await this.validateModel(resolved.credential!,value.definition.model!,value.definition.runtime);ready=true}catch{ready=false}return this.descriptor(value,ready,configured)}
 async listSafeDescriptors(){return Promise.all((await this.git.listConnections()).map(item=>this.safe(item)))}
 async getSafeDescriptor(key:string){const value=await this.git.getConnection(key);return value?this.safe(value):undefined}
 async resolveForExecution(key:string,snapshot?:ConnectionDescriptor){if(snapshot)return resolveGitSnapshotCredential(key,snapshot,this.vault);const value=await this.git.getConnection(key);if(!value)throw new Error("connection_unavailable");return resolveGitSnapshotCredential(key,this.descriptor(value,true),this.vault)}
 async resolveCredential(key:string,snapshot?:ConnectionDescriptor){return this.resolveForExecution(key,snapshot)}
}
