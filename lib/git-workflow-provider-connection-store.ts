import type {ConnectionDescriptor,ResolvedConnection} from "./workflow-connections.ts";
import type {WorkflowConnectionDefinitionRepository} from "./workflow-connection-definition-repository.ts";
import type {ProviderConnectionInput,WorkflowProviderConnectionStore} from "./workflow-provider-connection-store.ts";

const capabilities={asynchronous:true,cancellation:true};
export function resolveGitSnapshotCredential(key:string,snapshot:ConnectionDescriptor,bindings:Record<string,unknown>):ResolvedConnection{if(snapshot.management!=="git"||snapshot.key!==key||snapshot.adapter!=="openai-responses"||!snapshot.credentialSecretRef||!Object.prototype.hasOwnProperty.call(bindings,snapshot.credentialSecretRef)||typeof bindings[snapshot.credentialSecretRef]!=="string"||!bindings[snapshot.credentialSecretRef])throw new Error("connection_unavailable");return{...snapshot,enabled:true,credential:bindings[snapshot.credentialSecretRef] as string}}
export class GitAuthoritativeWorkflowProviderConnectionStore implements WorkflowProviderConnectionStore{
 private git:WorkflowConnectionDefinitionRepository;private fallback:WorkflowProviderConnectionStore;private bindings:Record<string,unknown>;
 constructor(git:WorkflowConnectionDefinitionRepository,fallback:WorkflowProviderConnectionStore,bindings:Record<string,unknown>){this.git=git;this.fallback=fallback;this.bindings=bindings}
 private credential(ref:string){if(!Object.prototype.hasOwnProperty.call(this.bindings,ref)||typeof this.bindings[ref]!=="string"||!(this.bindings[ref] as string))throw new Error("connection_unavailable");return this.bindings[ref] as string;}
 private descriptor(value:Awaited<ReturnType<WorkflowConnectionDefinitionRepository["listConnections"]>>[number],ready:boolean):ConnectionDescriptor{return{key:value.definition.id,name:value.definition.name,adapter:value.definition.runtime,endpoint:"https://api.openai.com/v1",defaultModel:value.definition.model,enabled:ready,management:"git",credentialSecretRef:value.definition.credential.secretRef,repositoryRevision:value.fileSha,capabilities}}
 private safe(value:Awaited<ReturnType<WorkflowConnectionDefinitionRepository["listConnections"]>>[number]){let ready=true;try{this.credential(value.definition.credential.secretRef)}catch{ready=false}return this.descriptor(value,ready)}
 async listSafeDescriptors(){const git=await this.git.listConnections(),owned=new Set(git.map(item=>item.definition.id)),fallback=(await this.fallback.listSafeDescriptors()).filter(item=>!owned.has(item.key));return[...git.map(item=>this.safe(item)),...fallback]}
 async getSafeDescriptor(key:string){const value=await this.git.getConnection(key);return value?this.safe(value):this.fallback.getSafeDescriptor(key)}
 async resolveCredential(key:string,snapshot?:ConnectionDescriptor):Promise<ResolvedConnection>{if(snapshot?.management==="git")return resolveGitSnapshotCredential(key,snapshot,this.bindings);const value=await this.git.getConnection(key);if(value){const result=this.safe(value);return{...result,enabled:true,credential:this.credential(value.definition.credential.secretRef)}}return this.fallback.resolveCredential(key,snapshot)}
 private async mutable(key:string){if(await this.git.getConnection(key))throw new Error("git_connection_read_only")}
 async upsertConnection(input:ProviderConnectionInput){await this.mutable(input.connectionKey);return this.fallback.upsertConnection(input)}
 async duplicateConnection(sourceKey:string,input:Omit<ProviderConnectionInput,"credential">){await this.mutable(sourceKey);await this.mutable(input.connectionKey);return this.fallback.duplicateConnection(sourceKey,input)}
 async deleteConnection(key:string){await this.mutable(key);return this.fallback.deleteConnection(key)}
}
