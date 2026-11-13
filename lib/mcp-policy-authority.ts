import {createHash} from "node:crypto";
import {approvalPolicySchema,type ApprovalPolicy} from "../adt-runtime/src/agent-contract.ts";
import {hasToolRole,requireToolRole} from "./agent-tool-roles.ts";
import type {McpServerDefinition} from "./tool-definitions.ts";
import type {WorkflowD1Database} from "./workflow-d1-storage.ts";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";

type PolicyEnvironment=Record<string,string|undefined>;
export type McpPolicyContext={authority:D1McpPolicyAuthority;actor:string;environment:PolicyEnvironment};
export type PolicyHead={repository_id:number;server_id:string;revision:number;state:"ready"|"updating"|"blocked";authority_id:string|null;mutation_id:string|null};
type Scope={url:string;authenticationMode:"none"|"bearer";bindingId?:string;credentialDigest?:string;schemas:Record<string,string>};
type Attestation={id:string;repository_id:number;server_id:string;scope_json:string;policies_digest:string;tool_digests_json:string;administrator:number;actor:string;created_at:number};
export type McpAdmissionAuthority={repositoryId:number;serverId:string;revision:number;authorityId:string};
export type McpPolicyVault=Pick<D1ProviderCredentialVault,"currentMcpServerCredentialBinding">;
const canonical=(value:unknown):string=>JSON.stringify(value&&typeof value==="object"?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,JSON.parse(canonical(v))])):value);
export const mcpPolicyDigest=(value:unknown)=>createHash("sha256").update(canonical(value)).digest("hex");
export function trustedPolicies(definition:McpServerDefinition){return Object.fromEntries(Object.entries(definition.toolPolicies??{}).map(([name,policy])=>[name,approvalPolicySchema.parse(policy)]))}
export async function mcpPolicyScope(repositoryId:number,definition:McpServerDefinition,vault:McpPolicyVault):Promise<Scope>{
 const policies=trustedPolicies(definition),schemas:Record<string,string>=Object.create(null);
 for(const name of Object.keys(policies)){const tool=definition.catalogue?.tools.find(tool=>tool.name===name);if(!tool)throw Error("mcp_policy_tool_unavailable");schemas[name]=mcpPolicyDigest(tool.inputSchema)}
 const bindingId=definition.authentication.mode==="bearer"?await vault.currentMcpServerCredentialBinding(repositoryId,definition.id,definition.endpointUrl,definition.authentication.credentialSecretRef):undefined;
 return{url:definition.endpointUrl,authenticationMode:definition.authentication.mode,...(bindingId?{bindingId}:{}),...(definition.authentication.mode==="bearer"&&Object.keys(policies).length?{credentialDigest:mcpPolicyDigest(definition.authentication.credentialSecretRef)}:{}),schemas};
}
function assertAttestation(record:Attestation,definition:McpServerDefinition,scope:Scope){
 const policies=trustedPolicies(definition);
 if(record.policies_digest!==mcpPolicyDigest(policies)||record.scope_json!==canonical(scope)||(Object.keys(policies).length>0&&record.administrator!==1))throw Error("mcp_policy_unverified");
}
export class D1McpPolicyAuthority{
 readonly db:WorkflowD1Database;
 constructor(db:WorkflowD1Database){this.db=db}
 async head(repositoryId:number,serverId:string){return await this.db.prepare("SELECT * FROM mcp_policy_heads WHERE repository_id=? AND server_id=?").bind(repositoryId,serverId).first<PolicyHead>()??undefined}
 async attestation(id:string){return await this.db.prepare("SELECT * FROM mcp_policy_attestations WHERE id=?").bind(id).first<Attestation>()??undefined}
 async verify(repositoryId:number,definition:McpServerDefinition,vault:McpPolicyVault){
  const head=await this.head(repositoryId,definition.id),record=head?.authority_id&&await this.attestation(head.authority_id);
  if(!head||head.state!=="ready"||!record||record.repository_id!==repositoryId||record.server_id!==definition.id)throw Error("mcp_policy_unverified");
  const scope=await mcpPolicyScope(repositoryId,definition,vault);assertAttestation(record,definition,scope);const latest=await this.head(repositoryId,definition.id);if(latest?.state!=="ready"||latest.revision!==head.revision||latest.authority_id!==head.authority_id)throw Error("mcp_policy_conflict");
  return{policies:trustedPolicies(definition),scope,credentialDigest:definition.authentication.mode==="bearer"?mcpPolicyDigest(definition.authentication.credentialSecretRef):undefined,guard:{repositoryId,serverId:definition.id,revision:head.revision,authorityId:record.id} satisfies McpAdmissionAuthority};
 }
 async verifyFrozen(repositoryId:number,item:{policyAuthorityId?:string;policy?:ApprovalPolicy;serverId:string;authenticationMode:string;credentialBindingId?:string;server:{url:string};tool:{name:string;inputSchema:Record<string,unknown>}},current:Awaited<ReturnType<D1McpPolicyAuthority["verify"]>>){
  const record=item.policyAuthorityId&&await this.attestation(item.policyAuthorityId);if(!record||record.repository_id!==repositoryId||record.server_id!==item.serverId)throw Error("mcp_policy_unverified");
  const scope=JSON.parse(record.scope_json) as Scope,digests=JSON.parse(record.tool_digests_json) as Record<string,string>;
  if(scope.url!==item.server.url||scope.authenticationMode!==item.authenticationMode||scope.bindingId!==item.credentialBindingId||scope.url!==current.scope.url||scope.authenticationMode!==current.scope.authenticationMode||scope.bindingId!==current.scope.bindingId||(scope.credentialDigest!==undefined&&scope.credentialDigest!==current.credentialDigest))throw Error("mcp_policy_unverified");
  if(digests[item.tool.name]!== (item.policy?mcpPolicyDigest(approvalPolicySchema.parse(item.policy)):undefined)||scope.schemas[item.tool.name]!== (item.policy?mcpPolicyDigest(item.tool.inputSchema):undefined)||(item.policy&&record.administrator!==1))throw Error("mcp_policy_unverified");
 }
 async begin(repositoryId:number,serverId:string,head:PolicyHead|undefined,recover=false){
  const mutationId=crypto.randomUUID();
  const result=head?await this.db.prepare("UPDATE mcp_policy_heads SET state='updating',mutation_id=?,revision=revision+1 WHERE repository_id=? AND server_id=? AND revision=? AND (state='ready' OR ?=1)").bind(mutationId,repositoryId,serverId,head.revision,recover?1:0).run():await this.db.prepare("INSERT OR IGNORE INTO mcp_policy_heads(repository_id,server_id,state,mutation_id,revision) VALUES(?,?,'updating',?,1)").bind(repositoryId,serverId,mutationId).run();
  if(result.meta?.changes!==1)throw Error("mcp_policy_conflict");return mutationId;
 }
 async publish(repositoryId:number,definition:McpServerDefinition,vault:McpPolicyVault,context:McpPolicyContext,mutationId:string){
  const policies=trustedPolicies(definition),administrator=hasToolRole(context.actor,"policy_admin",context.environment),head=await this.head(repositoryId,definition.id),previous=head?.authority_id?await this.attestation(head.authority_id):undefined;
  const scope=await mcpPolicyScope(repositoryId,definition,vault),policiesDigest=mcpPolicyDigest(policies);
  if(previous&&previous.scope_json===canonical(scope)&&previous.policies_digest===policiesDigest){
   const result=await this.db.prepare("UPDATE mcp_policy_heads SET state='ready',mutation_id=NULL,revision=revision+1 WHERE repository_id=? AND server_id=? AND mutation_id=? AND state='updating'").bind(repositoryId,definition.id,mutationId).run();if(result.meta?.changes!==1)throw Error("mcp_policy_conflict");return;
  }
  if(Object.keys(policies).length||(previous&&Object.keys(JSON.parse(previous.tool_digests_json)).length))requireToolRole(context.actor,"policy_admin",context.environment);
  const id=crypto.randomUUID(),digests=Object.fromEntries(Object.entries(policies).map(([name,value])=>[name,mcpPolicyDigest(value)]));
  const writes=await this.db.batch([
   this.db.prepare("INSERT INTO mcp_policy_attestations(id,repository_id,server_id,scope_json,policies_digest,tool_digests_json,administrator,actor,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM mcp_policy_heads WHERE repository_id=? AND server_id=? AND mutation_id=? AND state='updating')").bind(id,repositoryId,definition.id,canonical(scope),mcpPolicyDigest(policies),JSON.stringify(digests),administrator?1:0,context.actor.toLowerCase(),Date.now(),repositoryId,definition.id,mutationId),
   this.db.prepare("UPDATE mcp_policy_heads SET state='ready',authority_id=?,mutation_id=NULL,revision=revision+1 WHERE repository_id=? AND server_id=? AND mutation_id=? AND state='updating'").bind(id,repositoryId,definition.id,mutationId)
  ]);if(writes[1].meta?.changes!==1)throw Error("mcp_policy_conflict");
 }
 async settle(repositoryId:number,serverId:string,mutationId:string,old:PolicyHead|undefined,restore:boolean){
  const result=await this.db.prepare("UPDATE mcp_policy_heads SET state=?,authority_id=?,mutation_id=NULL,revision=revision+1 WHERE repository_id=? AND server_id=? AND mutation_id=? AND state='updating'").bind(restore?"ready":"blocked",old?.authority_id??null,repositoryId,serverId,mutationId).run();if(result.meta?.changes!==1)throw Error("mcp_policy_conflict");
 }
 async inspect(repositoryId:number,definition:McpServerDefinition,vault:McpPolicyVault){const head=await this.head(repositoryId,definition.id);try{await this.verify(repositoryId,definition,vault);return{verified:true,revision:head!.revision}}catch{return{verified:false,revision:head?.revision??0}}}
}
