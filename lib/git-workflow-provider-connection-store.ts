import {type ConnectionDescriptor,type ResolvedConnection} from "./workflow-connections.ts";
import type {WorkflowConnectionDefinitionRepository} from "./workflow-connection-definition-repository.ts";
import type {ProviderConnectionInput,WorkflowProviderConnectionStore} from "./workflow-provider-connection-store.ts";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";

const capabilities=(runtime:string)=>runtime==="openai-agents"?{asynchronous:false,cancellation:false}:{asynchronous:true,cancellation:true};
type VersionedConnection=Awaited<ReturnType<WorkflowConnectionDefinitionRepository["listConnections"]>>[number];
export async function resolveGitSnapshotCredential(key:string,snapshot:ConnectionDescriptor,vault?:Pick<D1ProviderCredentialVault,"resolve">):Promise<ResolvedConnection>{if(snapshot.management!=="git"||snapshot.key!==key||snapshot.credentialSource!=="adt-vault"||!snapshot.credentialSecretRef||!vault||!(["openai-responses","openai-agents"].includes(snapshot.adapter)))throw new Error("connection_unavailable");try{return{...snapshot,enabled:true,credential:await vault.resolve(snapshot.credentialSecretRef)}}catch{throw new Error("connection_unavailable")}}
export class GitAuthoritativeWorkflowProviderConnectionStore implements WorkflowProviderConnectionStore{
 private git:WorkflowConnectionDefinitionRepository;private validateModel:(credential:string,model:string)=>Promise<void>;private vault:Pick<D1ProviderCredentialVault,"resolve">;
 constructor(git:WorkflowConnectionDefinitionRepository,validateModel:(credential:string,model:string)=>Promise<void>,vault:Pick<D1ProviderCredentialVault,"resolve">){this.git=git;this.validateModel=validateModel;this.vault=vault;}
 private descriptor(value:VersionedConnection,ready:boolean,configured=ready):ConnectionDescriptor{return{key:value.definition.id,name:value.definition.name,adapter:value.definition.runtime,endpoint:"https://api.openai.com/v1",defaultModel:value.definition.model,enabled:ready,configured,management:"git",credentialSource:"adt-vault",credentialSecretRef:value.definition.credential.secretRef,repositoryRevision:value.fileSha,capabilities:capabilities(value.definition.runtime)}}
 private async safe(value:VersionedConnection){let ready=false,configured=false;try{const resolved=await resolveGitSnapshotCredential(value.definition.id,this.descriptor(value,false),this.vault);configured=true;await this.validateModel(resolved.credential!,value.definition.model);ready=true}catch{ready=false}return this.descriptor(value,ready,configured)}
 async listSafeDescriptors(){return Promise.all((await this.git.listConnections()).map(item=>this.safe(item)))}
 async getSafeDescriptor(key:string){const value=await this.git.getConnection(key);return value?this.safe(value):undefined}
 async resolveCredential(key:string,snapshot?:ConnectionDescriptor){if(snapshot)return resolveGitSnapshotCredential(key,snapshot,this.vault);const value=await this.git.getConnection(key);if(!value)throw new Error("connection_unavailable");return resolveGitSnapshotCredential(key,this.descriptor(value,true),this.vault)}
 async assertMutable(_key:string){throw new Error("git_connection_read_only")}
 async upsertConnection(_input:ProviderConnectionInput):Promise<never>{throw new Error("git_connection_read_only")}
 async duplicateConnection(_sourceKey:string,_input:Omit<ProviderConnectionInput,"credential">):Promise<never>{throw new Error("git_connection_read_only")}
 async deleteConnection(_key:string):Promise<never>{throw new Error("git_connection_read_only")}
}
