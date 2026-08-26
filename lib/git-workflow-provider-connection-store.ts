import {assertProviderConnectionKey,type ConnectionDescriptor,type ResolvedConnection} from "./workflow-connections.ts";
import type {WorkflowConnectionDefinitionRepository} from "./workflow-connection-definition-repository.ts";
import type {ProviderConnectionInput,WorkflowProviderConnectionStore} from "./workflow-provider-connection-store.ts";
import type {WorkflowProviderSecretResolver} from "./workflow-provider-secret-resolver.ts";

const capabilities=(runtime:string)=>runtime==="openai-agents"?{asynchronous:false,cancellation:false}:{asynchronous:true,cancellation:true};
type VersionedConnection=Awaited<ReturnType<WorkflowConnectionDefinitionRepository["listConnections"]>>[number];
export function resolveGitSnapshotCredential(key:string,snapshot:ConnectionDescriptor,secrets:WorkflowProviderSecretResolver):ResolvedConnection{if(snapshot.management!=="git"||snapshot.key!==key||!(["openai-responses","openai-agents"].includes(snapshot.adapter))||!snapshot.credentialSecretRef)throw new Error("connection_unavailable");return{...snapshot,enabled:true,credential:secrets.resolve(snapshot.credentialSecretRef)}}
export class GitAuthoritativeWorkflowProviderConnectionStore implements WorkflowProviderConnectionStore{
 constructor(privateGit:WorkflowConnectionDefinitionRepository,privateFallback:WorkflowProviderConnectionStore,privateSecrets:WorkflowProviderSecretResolver,privateValidateModel:(credential:string,model:string)=>Promise<void>){this.git=privateGit;this.fallback=privateFallback;this.secrets=privateSecrets;this.validateModel=privateValidateModel}
 private git:WorkflowConnectionDefinitionRepository;private fallback:WorkflowProviderConnectionStore;private secrets:WorkflowProviderSecretResolver;private validateModel:(credential:string,model:string)=>Promise<void>;
 private descriptor(value:VersionedConnection,ready:boolean,configured=ready):ConnectionDescriptor{return{key:value.definition.id,name:value.definition.name,adapter:value.definition.runtime,endpoint:"https://api.openai.com/v1",defaultModel:value.definition.model,enabled:ready,configured,management:"git",credentialSecretRef:value.definition.credential.secretRef,repositoryRevision:value.fileSha,capabilities:capabilities(value.definition.runtime)}}
 private async safe(value:VersionedConnection){let ready=false,configured=false;try{const credential=this.secrets.resolve(value.definition.credential.secretRef);configured=true;await this.validateModel(credential,value.definition.model);ready=true}catch{ready=false}return this.descriptor(value,ready,configured)}
 async listSafeDescriptors(){const git=await this.git.listConnections(),owned=new Set(git.map(item=>item.definition.id)),fallback=(await this.fallback.listSafeDescriptors()).filter(item=>!owned.has(item.key));return[...await Promise.all(git.map(item=>this.safe(item))),...fallback]}
 async getSafeDescriptor(key:string){const value=await this.git.getConnection(key);return value?this.safe(value):this.fallback.getSafeDescriptor(key)}
 async resolveCredential(key:string,snapshot?:ConnectionDescriptor):Promise<ResolvedConnection>{if(snapshot?.management==="git")return resolveGitSnapshotCredential(key,snapshot,this.secrets);if(snapshot?.management==="d1")return this.fallback.resolveCredential(key,snapshot);const value=await this.git.getConnection(key);if(value)return{...this.descriptor(value,true),credential:this.secrets.resolve(value.definition.credential.secretRef)};return this.fallback.resolveCredential(key,snapshot)}
 private async mutable(key:string){if(await this.git.getConnection(key))throw new Error("git_connection_read_only")}
 async assertMutable(key:string){assertProviderConnectionKey(key);await this.mutable(key)}
 async upsertConnection(input:ProviderConnectionInput){await this.assertMutable(input.connectionKey);return this.fallback.upsertConnection(input)}
 async duplicateConnection(sourceKey:string,input:Omit<ProviderConnectionInput,"credential">){assertProviderConnectionKey(input.connectionKey);await this.mutable(sourceKey);await this.mutable(input.connectionKey);return this.fallback.duplicateConnection(sourceKey,input)}
 async deleteConnection(key:string){await this.assertMutable(key);return this.fallback.deleteConnection(key)}
}
