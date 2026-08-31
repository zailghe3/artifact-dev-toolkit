import {z} from "zod";
import {DEFINITION_ID} from "./workflow-definitions.ts";
import {RESERVED_CONNECTION_KEYS} from "./workflow-connections.ts";
import {isProviderCredentialVaultSecretId} from "./provider-credential-vault.ts";

export const CONNECTION_ROOT="connections";
export const CONNECTION_SUFFIX=".connection.json";
export const CONNECTION_NAME_MAX_LENGTH=120;
const id=z.string().max(80).regex(DEFINITION_ID);

const vaultCredential=z.object({source:z.literal("adt-vault"),secretRef:z.string().refine(isProviderCredentialVaultSecretId,"Invalid ADT vault secret reference.")}).strict();
export const connectionDefinitionSchema=z.object({
 schemaVersion:z.literal(1),id,name:z.string().trim().min(1).max(CONNECTION_NAME_MAX_LENGTH),runtime:z.enum(["openai-responses","openai-agents"]),provider:z.literal("openai"),model:z.string().trim().min(1).max(120),credential:vaultCredential,
}).strict().superRefine((value,context)=>{if(RESERVED_CONNECTION_KEYS.has(value.id))context.addIssue({code:"custom",message:"Reserved connection IDs are not permitted.",path:["id"]})});
export type ConnectionDefinition=z.infer<typeof connectionDefinitionSchema>;
export const connectionDefinitionPath=(value:string)=>`${CONNECTION_ROOT}/${id.parse(value)}${CONNECTION_SUFFIX}`;

export function parseConnectionDefinition(value:unknown,path:string){
 const definition=connectionDefinitionSchema.parse(value),name=path.split("/").at(-1),expected=`${definition.id}${CONNECTION_SUFFIX}`;
 if(path!==`${CONNECTION_ROOT}/${name}`||name!==expected)throw new Error("invalid_connection_definition_identity");
 return definition;
}
