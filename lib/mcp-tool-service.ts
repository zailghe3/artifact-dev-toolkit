import {mcpCatalogueToolSchema,mcpServerDefinitionSchema,safeMcpServer,type McpServerDefinition} from "./tool-definitions.ts";
import type {ToolDefinitionRepository} from "./tool-definition-repository.ts";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";
import type {RemoteOpenAIAgentsRuntime} from "./adt-runtime-client.ts";
import {z} from "zod";

type Vault=Pick<D1ProviderCredentialVault,"create"|"resolve"|"replace"|"delete">;
export const mcpServerInputSchema=z.object({id:z.string(),name:z.string(),endpointUrl:z.string(),authenticationMode:z.enum(["none","bearer"]),bearerToken:z.string().max(8192).optional()}).strict();
export async function createMcpServer(input:z.infer<typeof mcpServerInputSchema>,repo:ToolDefinitionRepository,vault:Vault){const value=mcpServerInputSchema.parse(input);let ref:string|undefined;if(value.authenticationMode==="bearer"){if(!value.bearerToken?.trim())throw new Error("credential_required");ref=await vault.create(value.bearerToken)}try{const definition=mcpServerDefinitionSchema.parse({schemaVersion:1,id:value.id,name:value.name,type:"mcp",transport:"streamable-http",endpointUrl:value.endpointUrl,authentication:value.authenticationMode==="bearer"?{mode:"bearer",credentialSecretRef:ref}:{mode:"none"}});return await repo.create(definition)}catch(error){if(ref)await vault.delete(ref);throw error}}
export async function updateMcpServer(input:z.infer<typeof mcpServerInputSchema> & {fileSha:string},repo:ToolDefinitionRepository,vault:Vault){
 const old=await repo.get(input.id);if(!old)throw new Error("tool_not_found");
 let authentication:McpServerDefinition["authentication"];
 if(input.authenticationMode==="none")authentication={mode:"none"};
 else if(old.definition.authentication.mode==="bearer"){
  authentication=old.definition.authentication;
  if(input.bearerToken?.trim())await vault.replace(authentication.credentialSecretRef,input.bearerToken);
 }else{
  if(!input.bearerToken?.trim())throw new Error("credential_required");
  authentication={mode:"bearer",credentialSecretRef:await vault.create(input.bearerToken)};
  return repo.update({...old.definition,name:input.name,endpointUrl:input.endpointUrl,authentication},input.fileSha);
 }
 const saved=await repo.update({...old.definition,name:input.name,endpointUrl:input.endpointUrl,authentication},input.fileSha);
 if(input.authenticationMode==="none"&&old.definition.authentication.mode==="bearer")await vault.delete(old.definition.authentication.credentialSecretRef);
 return saved;
}
export async function deleteMcpServer(id:string,fileSha:string,repo:ToolDefinitionRepository,vault:Vault){const old=await repo.get(id);if(!old)throw new Error("tool_not_found");await repo.delete(id,fileSha);if(old.definition.authentication.mode==="bearer")await vault.delete(old.definition.authentication.credentialSecretRef)}
export async function discoverMcpServer(id:string,fileSha:string,repo:ToolDefinitionRepository,vault:Vault,runtime:Pick<RemoteOpenAIAgentsRuntime,"discoverMcp">,now=()=>new Date()){const old=await repo.get(id);if(!old)throw new Error("tool_not_found");if(old.fileSha!==fileSha)throw new Error("definition_conflict");const credential=old.definition.authentication.mode==="bearer"?await vault.resolve(old.definition.authentication.credentialSecretRef):undefined;const tools=z.array(mcpCatalogueToolSchema).max(128).parse(await runtime.discoverMcp({url:old.definition.endpointUrl,transport:"streamable-http"},credential));return repo.update({...old.definition,catalogue:{tools,refreshedAt:now().toISOString()}},fileSha)}
export const safeVersionedMcp=(value:{definition:McpServerDefinition;fileSha:string})=>({definition:safeMcpServer(value.definition),fileSha:value.fileSha});

export async function validateAgentMcpGrants(agent:import("./workflow-definitions.ts").AgentDefinitionV1,repo:Pick<ToolDefinitionRepository,"list">){const {mcpToolGrants}=await import("./workflow-definitions.ts"),grants=mcpToolGrants(agent.tools);if(!grants.length)return agent;const servers=new Map((await repo.list()).map(item=>[item.definition.id,item.definition]));for(const grant of grants){const server=servers.get(grant.serverId);if(!server?.catalogue?.tools.some(tool=>tool.name===grant.toolName))throw new Error("mcp_grant_unavailable")}return agent}
