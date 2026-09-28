import {mcpCatalogueToolSchema,mcpServerDefinitionSchema,safeMcpServer,type McpServerDefinition} from "./tool-definitions.ts";
import type {ToolDefinitionRepository} from "./tool-definition-repository.ts";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";
import type {RemoteOpenAIAgentsRuntime} from "./adt-runtime-client.ts";
import {z} from "zod";

type Vault=Pick<D1ProviderCredentialVault,"create"|"resolve"|"delete"|"bindMcpServerCredential"|"unbindMcpServerCredential">;
export const mcpServerInputSchema=z.object({id:z.string(),name:z.string(),endpointUrl:z.string(),authenticationMode:z.enum(["none","bearer"]),bearerToken:z.string().max(8192).optional()}).strict();
const cleanupSecret=async(vault:Vault,secretId:string|undefined)=>{if(secretId)await vault.delete(secretId).catch(()=>undefined)};
const restoreBinding=async(repositoryId:number,id:string,authentication:McpServerDefinition["authentication"],candidate:string|undefined,vault:Vault)=>{if(authentication.mode==="bearer"){try{await vault.bindMcpServerCredential(repositoryId,id,authentication.credentialSecretRef,candidate)}catch{await vault.bindMcpServerCredential(repositoryId,id,authentication.credentialSecretRef)}}else if(candidate)await vault.unbindMcpServerCredential(repositoryId,id,candidate).catch(()=>undefined)};

export async function createMcpServer(repositoryId:number,input:z.infer<typeof mcpServerInputSchema>,repo:ToolDefinitionRepository,vault:Vault){
 const value=mcpServerInputSchema.parse(input);let ref:string|undefined;
 if(value.authenticationMode==="bearer"){if(!value.bearerToken?.trim())throw new Error("credential_required");ref=await vault.create(value.bearerToken)}
 const definition=mcpServerDefinitionSchema.parse({schemaVersion:1,id:value.id,name:value.name,type:"mcp",transport:"streamable-http",endpointUrl:value.endpointUrl,authentication:value.authenticationMode==="bearer"?{mode:"bearer",credentialSecretRef:ref}:{mode:"none"}});
 let created:Awaited<ReturnType<ToolDefinitionRepository["create"]>>;
 try{created=await repo.create(definition)}catch(error){await cleanupSecret(vault,ref);throw error}
 if(!ref)return created;
 try{await vault.bindMcpServerCredential(repositoryId,value.id,ref);return created}catch(error){
  await vault.unbindMcpServerCredential(repositoryId,value.id,ref).catch(()=>undefined);
  await repo.delete(value.id,created.fileSha).catch(()=>undefined);
  await cleanupSecret(vault,ref);
  throw error;
 }
}

export async function updateMcpServer(repositoryId:number,input:z.infer<typeof mcpServerInputSchema>&{fileSha:string},repo:ToolDefinitionRepository,vault:Vault){
 const old=await repo.get(input.id);if(!old)throw new Error("tool_not_found");
 let authentication:McpServerDefinition["authentication"],candidate:string|undefined,obsolete:string|undefined;
 if(input.authenticationMode==="none")authentication={mode:"none"};
 else if(old.definition.authentication.mode==="bearer"){
  authentication=old.definition.authentication;
  if(input.bearerToken?.trim()){candidate=await vault.create(input.bearerToken);obsolete=authentication.credentialSecretRef;authentication={mode:"bearer",credentialSecretRef:candidate}}
 }else{if(!input.bearerToken?.trim())throw new Error("credential_required");candidate=await vault.create(input.bearerToken);authentication={mode:"bearer",credentialSecretRef:candidate}}
 if(input.authenticationMode==="none"&&old.definition.authentication.mode==="bearer")obsolete=old.definition.authentication.credentialSecretRef;
 let saved:Awaited<ReturnType<ToolDefinitionRepository["update"]>>;
 try{saved=await repo.update({...old.definition,name:input.name,endpointUrl:input.endpointUrl,authentication},input.fileSha)}catch(error){await cleanupSecret(vault,candidate);throw error}
 const authorityChanged=old.definition.authentication.mode!==authentication.mode||old.definition.authentication.mode==="bearer"&&authentication.mode==="bearer"&&old.definition.authentication.credentialSecretRef!==authentication.credentialSecretRef;
 if(authorityChanged)try{
  if(authentication.mode==="bearer")await vault.bindMcpServerCredential(repositoryId,input.id,authentication.credentialSecretRef,old.definition.authentication.mode==="bearer"?old.definition.authentication.credentialSecretRef:null);
  else await vault.unbindMcpServerCredential(repositoryId,input.id,old.definition.authentication.mode==="bearer"?old.definition.authentication.credentialSecretRef:undefined);
 }catch(error){
  let bindingRestored=false;try{await restoreBinding(repositoryId,input.id,old.definition.authentication,candidate,vault);bindingRestored=true}catch{/* Secret retirement below makes unresolved compensation fail closed. */}
  let gitRestored=false;try{await repo.update(old.definition,saved.fileSha);gitRestored=true}catch{/* A non-restorable Git transition is disabled below. */}
  if(!bindingRestored||!gitRestored){await cleanupSecret(vault,candidate);if(old.definition.authentication.mode==="bearer"&&!gitRestored)await cleanupSecret(vault,old.definition.authentication.credentialSecretRef)}else await cleanupSecret(vault,candidate);
  throw error;
 }
 await cleanupSecret(vault,obsolete);
 return saved;
}

export async function deleteMcpServer(repositoryId:number,id:string,fileSha:string,repo:ToolDefinitionRepository,vault:Vault){
 const old=await repo.get(id);if(!old)throw new Error("tool_not_found");
 await repo.delete(id,fileSha);
 if(old.definition.authentication.mode!=="bearer")return;
 const secret=old.definition.authentication.credentialSecretRef;
 try{await vault.unbindMcpServerCredential(repositoryId,id,secret)}catch(error){
  let bindingRestored=false;try{await vault.bindMcpServerCredential(repositoryId,id,secret);bindingRestored=true}catch{/* Recreate may still leave a safely unavailable definition. */}
  let gitRestored=false;try{await repo.create(old.definition);gitRestored=true}catch{/* Remove executable authority when Git cannot be restored. */}
  if(!bindingRestored||!gitRestored){await vault.unbindMcpServerCredential(repositoryId,id,secret).catch(()=>undefined);await cleanupSecret(vault,secret)}
  throw error;
 }
 await cleanupSecret(vault,secret);
}
export async function discoverMcpServer(id:string,fileSha:string,repo:ToolDefinitionRepository,vault:Vault,runtime:Pick<RemoteOpenAIAgentsRuntime,"discoverMcp">,now=()=>new Date()){const old=await repo.get(id);if(!old)throw new Error("tool_not_found");if(old.fileSha!==fileSha)throw new Error("definition_conflict");const credential=old.definition.authentication.mode==="bearer"?await vault.resolve(old.definition.authentication.credentialSecretRef):undefined;const tools=z.array(mcpCatalogueToolSchema).max(128).parse(await runtime.discoverMcp({url:old.definition.endpointUrl,transport:"streamable-http"},credential));return repo.update({...old.definition,catalogue:{tools,refreshedAt:now().toISOString()}},fileSha)}
export const safeVersionedMcp=(value:{definition:McpServerDefinition;fileSha:string})=>({definition:safeMcpServer(value.definition),fileSha:value.fileSha});

export async function validateAgentMcpGrants(agent:import("./workflow-definitions.ts").AgentDefinitionV1,repo:Pick<ToolDefinitionRepository,"list">){const {mcpToolGrants}=await import("./workflow-definitions.ts"),grants=mcpToolGrants(agent.tools);if(!grants.length)return agent;const servers=new Map((await repo.list()).map(item=>[item.definition.id,item.definition]));for(const grant of grants){const server=servers.get(grant.serverId);if(!server?.catalogue?.tools.some(tool=>tool.name===grant.toolName))throw new Error("mcp_grant_unavailable")}return agent}
