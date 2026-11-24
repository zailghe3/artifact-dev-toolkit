import {hasToolRole,requireToolRole} from "./agent-tool-roles.ts";
import {mcpPolicyDigest,mcpPolicyScope,trustedPolicies,type McpPolicyContext} from "./mcp-policy-authority.ts";
import {approvalPolicySchema} from "../adt-runtime/src/agent-contract.ts";
import {mcpCatalogueToolSchema,mcpServerDefinitionSchema,safeMcpServer,type McpServerDefinition} from "./tool-definitions.ts";
import type {ToolDefinitionRepository} from "./tool-definition-repository.ts";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";
import {z} from "zod";

type Vault=Pick<D1ProviderCredentialVault,"create"|"hasCredential"|"delete"|"ensureMcpServerCredentialBinding"|"rotateMcpServerCredential"|"replaceMcpServerCredentialBinding"|"restoreMcpServerCredentialBinding"|"revokeMcpServerCredentialBinding"|"currentMcpServerCredentialBinding">;
export const mcpServerInputSchema=z.object({id:mcpServerDefinitionSchema.shape.id,name:mcpServerDefinitionSchema.shape.name,endpointUrl:mcpServerDefinitionSchema.shape.endpointUrl,authenticationMode:z.enum(["none","bearer"]),bearerToken:z.string().max(8192).optional(),toolPolicies:z.record(z.string(),approvalPolicySchema).optional()}).strict();
const cleanupSecret=async(vault:Vault,secretId:string|undefined)=>{if(secretId)await vault.delete(secretId).catch(()=>undefined)};

async function createMcpServerUnchecked(repositoryId:number,input:z.infer<typeof mcpServerInputSchema>,repo:ToolDefinitionRepository,vault:Vault){
 const value=mcpServerInputSchema.parse(input);let ref:string|undefined;if(value.authenticationMode==="bearer"){if(!value.bearerToken?.trim())throw new Error("credential_required");ref=await vault.create(value.bearerToken)}
 const definition=mcpServerDefinitionSchema.parse({schemaVersion:1,id:value.id,name:value.name,type:"mcp",transport:"streamable-http",endpointUrl:value.endpointUrl,...(value.toolPolicies?{toolPolicies:value.toolPolicies}:{}),authentication:value.authenticationMode==="bearer"?{mode:"bearer",credentialSecretRef:ref}:{mode:"none"}});let created:Awaited<ReturnType<ToolDefinitionRepository["create"]>>;
 try{created=await repo.create(definition)}catch(error){await cleanupSecret(vault,ref);throw error}if(!ref)return created;
 let bindingId:string|undefined;try{bindingId=await vault.ensureMcpServerCredentialBinding(repositoryId,value.id,value.endpointUrl,ref);return created}catch(error){if(bindingId)await vault.revokeMcpServerCredentialBinding(repositoryId,value.id,bindingId).catch(()=>undefined);await repo.delete(value.id,created.fileSha).catch(()=>undefined);await cleanupSecret(vault,ref);throw error}
}

async function existingBearerBinding(repositoryId:number,definition:McpServerDefinition,vault:Vault){
 if(definition.authentication.mode!=="bearer")return;
 const ref=definition.authentication.credentialSecretRef;
 try{return await vault.ensureMcpServerCredentialBinding(repositoryId,definition.id,definition.endpointUrl,ref)}
 catch(error){
  if(!await vault.hasCredential(ref))return;
  throw error;
 }
}

async function updateMcpServerUnchecked(repositoryId:number,input:z.infer<typeof mcpServerInputSchema>&{fileSha:string},repo:ToolDefinitionRepository,vault:Vault){
 const old=await repo.get(input.id);if(!old)throw new Error("tool_not_found");if(old.fileSha!==input.fileSha)throw Error("definition_conflict");const oldAuth=old.definition.authentication,oldBindingId=await existingBearerBinding(repositoryId,old.definition,vault),endpointChanged=old.definition.endpointUrl!==input.endpointUrl;
 let authentication:McpServerDefinition["authentication"],candidate:string|undefined,obsolete:string|undefined;if(input.authenticationMode==="none")authentication={mode:"none"};else if(oldAuth.mode==="bearer"&&oldBindingId){authentication=oldAuth;if(input.bearerToken?.trim()){candidate=await vault.create(input.bearerToken);obsolete=oldAuth.credentialSecretRef;authentication={mode:"bearer",credentialSecretRef:candidate}}}else{if(!input.bearerToken?.trim())throw new Error("credential_required");candidate=await vault.create(input.bearerToken);authentication={mode:"bearer",credentialSecretRef:candidate}}
 if(input.authenticationMode==="none"&&oldAuth.mode==="bearer")obsolete=oldAuth.credentialSecretRef;let saved:Awaited<ReturnType<ToolDefinitionRepository["update"]>>;try{saved=await repo.update({...old.definition,name:input.name,endpointUrl:input.endpointUrl,authentication,...(endpointChanged||oldAuth.mode!==authentication.mode?{toolPolicies:input.toolPolicies}:input.toolPolicies!==undefined?{toolPolicies:input.toolPolicies}:{})},input.fileSha)}catch(error){await cleanupSecret(vault,candidate);throw error}
 let newBindingId:string|undefined;try{
  if(oldAuth.mode==="bearer"&&oldBindingId&&authentication.mode==="bearer"){if(endpointChanged)newBindingId=await vault.replaceMcpServerCredentialBinding(repositoryId,input.id,oldBindingId!,old.definition.endpointUrl,input.endpointUrl,authentication.credentialSecretRef);else{newBindingId=oldBindingId;if(authentication.credentialSecretRef!==oldAuth.credentialSecretRef)await vault.rotateMcpServerCredential(repositoryId,input.id,oldBindingId!,input.endpointUrl,authentication.credentialSecretRef,oldAuth.credentialSecretRef)}}
  else if(oldAuth.mode==="bearer"&&oldBindingId)await vault.revokeMcpServerCredentialBinding(repositoryId,input.id,oldBindingId!);
  else if(authentication.mode==="bearer")newBindingId=await vault.ensureMcpServerCredentialBinding(repositoryId,input.id,input.endpointUrl,authentication.credentialSecretRef);
 }catch(error){
  let authorityRestored=false;try{if(oldAuth.mode==="bearer"&&oldBindingId)await vault.restoreMcpServerCredentialBinding(repositoryId,input.id,oldBindingId!,old.definition.endpointUrl,oldAuth.credentialSecretRef);else if(newBindingId)await vault.revokeMcpServerCredentialBinding(repositoryId,input.id,newBindingId);authorityRestored=true}catch{/* Secret retirement below makes incomplete compensation fail closed. */}
  let gitRestored=false;try{await repo.update(old.definition,saved.fileSha);gitRestored=true}catch{/* Incomplete Git compensation is disabled below. */}
  if(!authorityRestored||!gitRestored){await cleanupSecret(vault,candidate);if(oldAuth.mode==="bearer"&&!gitRestored)await cleanupSecret(vault,oldAuth.credentialSecretRef)}else await cleanupSecret(vault,candidate);throw error
 }
 if(obsolete&&!(authentication.mode==="bearer"&&obsolete===authentication.credentialSecretRef))await cleanupSecret(vault,obsolete);return saved;
}

async function deleteMcpServerUnchecked(repositoryId:number,id:string,fileSha:string,repo:ToolDefinitionRepository,vault:Vault){const old=await repo.get(id);if(!old)throw new Error("tool_not_found");if(old.fileSha!==fileSha)throw Error("definition_conflict");const auth=old.definition.authentication,bindingId=await existingBearerBinding(repositoryId,old.definition,vault);await repo.delete(id,fileSha);if(auth.mode!=="bearer")return;try{await vault.revokeMcpServerCredentialBinding(repositoryId,id,bindingId!)}catch(error){let authorityRestored=false;try{await vault.restoreMcpServerCredentialBinding(repositoryId,id,bindingId!,old.definition.endpointUrl,auth.credentialSecretRef);authorityRestored=true}catch{}let gitRestored=false;try{await repo.create(old.definition);gitRestored=true}catch{}if(!authorityRestored||!gitRestored)await cleanupSecret(vault,auth.credentialSecretRef);throw error}await cleanupSecret(vault,auth.credentialSecretRef)}
async function discoverMcpServerUnchecked(id:string,fileSha:string,repo:ToolDefinitionRepository,runtime:{discoverMcp(definition:McpServerDefinition):Promise<unknown>},now=()=>new Date()){const old=await repo.get(id);if(!old)throw new Error("tool_not_found");if(old.fileSha!==fileSha)throw new Error("definition_conflict");const tools=z.array(mcpCatalogueToolSchema).max(128).parse(await runtime.discoverMcp(old.definition));return repo.update({...old.definition,catalogue:{tools,refreshedAt:now().toISOString()}},fileSha)}
export const safeVersionedMcp=(value:{definition:McpServerDefinition;fileSha:string})=>({definition:safeMcpServer(value.definition),fileSha:value.fileSha});

export async function validateAgentMcpGrants(agent:import("./workflow-definitions.ts").AgentDefinitionV1,repo:Pick<ToolDefinitionRepository,"list">){const {mcpToolGrants}=await import("./workflow-definitions.ts"),grants=mcpToolGrants(agent.tools);if(!grants.length)return agent;const servers=new Map((await repo.list()).map(item=>[item.definition.id,item.definition]));for(const grant of grants){const server=servers.get(grant.serverId);if(!server?.catalogue?.tools.some(tool=>tool.name===grant.toolName))throw new Error("mcp_grant_unavailable")}return agent}

/** Persisted policy state locks authority before any Git/credential mutation. Interrupted writes stay blocked. */
async function mutateMcp<T>(repositoryId:number,id:string,repo:ToolDefinitionRepository,vault:Vault,context:McpPolicyContext,kind:"create"|"update"|"delete"|"discover",input:{fileSha?:string;toolPolicies?:McpServerDefinition["toolPolicies"];endpointUrl?:string;authenticationMode?:string;bearerToken?:string},write:(policies:McpServerDefinition["toolPolicies"])=>Promise<T>):Promise<T>{
 const old=await repo.get(id),head=await context.authority.head(repositoryId,id),admin=hasToolRole(context.actor,"policy_admin",context.environment);
 if(kind!=="create"&&(!old||old.fileSha!==input.fileSha))throw Error(old?"definition_conflict":"tool_not_found");
 if(kind==="create"&&old)throw Error("definition_conflict");
 let verified=false;if(old)try{await context.authority.verify(repositoryId,old.definition,vault);verified=true}catch{}
 const explicit=input.toolPolicies!==undefined;
 if((head&&!old)|| (old&&!verified)){if(!admin||!explicit||kind==="delete"||kind==="discover")throw Error("mcp_policy_unverified")}
 const previous=old?trustedPolicies(old.definition):{},targetChanged=!!old&&(input.endpointUrl!==old.definition.endpointUrl||input.authenticationMode!==old.definition.authentication.mode||Boolean(input.bearerToken?.trim()));
 const policies=kind==="update"?(explicit?input.toolPolicies!:targetChanged?{}:previous):input.toolPolicies??{};
 if((kind==="delete"&&Object.keys(previous).length)||(kind==="update"&&(mcpPolicyDigest(previous)!==mcpPolicyDigest(policies)||(targetChanged&&Object.keys(previous).length)))||(kind==="create"&&Object.keys(policies).length))requireToolRole(context.actor,"policy_admin",context.environment);
 // Validate policy tool identities before creating credentials or mutating Git.
 if(kind!=="delete"&&kind!=="discover")for(const name of Object.keys(policies))if(!old?.definition.catalogue?.tools.some(tool=>tool.name===name))throw Error("mcp_policy_tool_unavailable");
 const mutationId=await context.authority.begin(repositoryId,id,head,admin&&explicit);
 try{
  const result=await write(policies),saved=await repo.get(id);
  if(kind!=="delete"){const expected=result as {definition:McpServerDefinition;fileSha:string};if(!saved||saved.fileSha!==expected.fileSha||mcpPolicyDigest(saved.definition)!==mcpPolicyDigest(expected.definition))throw Error("mcp_policy_conflict")}
  if(kind==="delete"){if(saved)throw Error("mcp_policy_conflict");await context.authority.settle(repositoryId,id,mutationId,head,false)}
  else{if(!saved)throw Error("mcp_policy_conflict");await context.authority.publish(repositoryId,saved.definition,vault,context,mutationId)}
  return result;
 }catch(error){
  let restore=false;
  if(old&&head?.state==="ready")try{const current=await repo.get(id),record=head.authority_id&&await context.authority.attestation(head.authority_id);if(current&&record&&mcpPolicyDigest(current.definition)===mcpPolicyDigest(old.definition)){const scope=await mcpPolicyScope(repositoryId,current.definition,vault);restore=mcpPolicyDigest(scope)===mcpPolicyDigest(JSON.parse(record.scope_json))&&record.policies_digest===mcpPolicyDigest(trustedPolicies(current.definition))}}catch{}
  await context.authority.settle(repositoryId,id,mutationId,head,restore).catch(()=>undefined);throw error;
 }
}
export async function createMcpServer(repositoryId:number,input:z.infer<typeof mcpServerInputSchema>,repo:ToolDefinitionRepository,vault:Vault,context:McpPolicyContext){const value=mcpServerInputSchema.parse(input);return mutateMcp(repositoryId,value.id,repo,vault,context,"create",value,()=>createMcpServerUnchecked(repositoryId,value,repo,vault))}
export async function updateMcpServer(repositoryId:number,input:z.infer<typeof mcpServerInputSchema>&{fileSha:string},repo:ToolDefinitionRepository,vault:Vault,context:McpPolicyContext){const value=mcpServerInputSchema.parse(Object.fromEntries(Object.entries(input).filter(([key])=>key!=="fileSha")));return mutateMcp(repositoryId,value.id,repo,vault,context,"update",input,policies=>updateMcpServerUnchecked(repositoryId,{...value,toolPolicies:policies,fileSha:input.fileSha},repo,vault))}
export async function deleteMcpServer(repositoryId:number,id:string,fileSha:string,repo:ToolDefinitionRepository,vault:Vault,context:McpPolicyContext){return mutateMcp(repositoryId,id,repo,vault,context,"delete",{fileSha},()=>deleteMcpServerUnchecked(repositoryId,id,fileSha,repo,vault))}
export async function discoverMcpServer(repositoryId:number,id:string,fileSha:string,repo:ToolDefinitionRepository,vault:Vault,runtime:{discoverMcp(definition:McpServerDefinition):Promise<unknown>},context:McpPolicyContext,now=()=>new Date()){
 return mutateMcp(repositoryId,id,repo,vault,context,"discover",{fileSha},async()=>{
  const old=(await repo.get(id))!,scope=await mcpPolicyScope(repositoryId,old.definition,vault);
  const checked={...repo,get:repo.get.bind(repo),update:async(value:McpServerDefinition,sha:string)=>{if(mcpPolicyDigest(await mcpPolicyScope(repositoryId,value,vault))!==mcpPolicyDigest(scope))throw Error("mcp_policy_tool_unavailable");return repo.update(value,sha)}};
  return discoverMcpServerUnchecked(id,fileSha,checked as ToolDefinitionRepository,runtime,now);
 });
}
