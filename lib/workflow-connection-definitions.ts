import {z} from "zod";
import {DEFINITION_ID} from "./workflow-definitions.ts";
import {RESERVED_CONNECTION_KEYS} from "./workflow-connections.ts";
import {isProviderCredentialVaultSecretId} from "./provider-credential-vault.ts";

export const CONNECTION_ROOT="connections";
export const CONNECTION_SUFFIX=".connection.json";
export const PROVIDER_CONNECTION_SECRET_PREFIX="WORKFLOW_PROVIDER_CONNECTION_";
export const SECRET_BINDING=/^WORKFLOW_PROVIDER_CONNECTION_[A-Z0-9][A-Z0-9_]{0,79}$/;
const id=z.string().max(80).regex(DEFINITION_ID);

const legacyCredential=z.object({secretRef:z.string().regex(SECRET_BINDING)}).strict();
const vaultCredential=z.object({source:z.literal("adt-vault"),secretRef:z.string().refine(isProviderCredentialVaultSecretId,"Invalid ADT vault secret reference.")}).strict();
export const connectionDefinitionSchema=z.object({
 schemaVersion:z.literal(1),id,name:z.string().trim().min(1).max(120),runtime:z.enum(["openai-responses","openai-agents"]),provider:z.literal("openai"),model:z.string().trim().min(1).max(120),credential:z.union([legacyCredential,vaultCredential]),
}).strict().superRefine((value,context)=>{if(RESERVED_CONNECTION_KEYS.has(value.id))context.addIssue({code:"custom",message:"Reserved connection IDs are not permitted.",path:["id"]})});
export type ConnectionDefinition=z.infer<typeof connectionDefinitionSchema>;
export const connectionDefinitionPath=(value:string)=>`${CONNECTION_ROOT}/${id.parse(value)}${CONNECTION_SUFFIX}`;

export function parseConnectionDefinition(value:unknown,path:string){
 const definition=connectionDefinitionSchema.parse(value),name=path.split("/").at(-1),expected=`${definition.id}${CONNECTION_SUFFIX}`;
 if(path!==`${CONNECTION_ROOT}/${name}`||name!==expected)throw new Error("invalid_connection_definition_identity");
 return definition;
}
