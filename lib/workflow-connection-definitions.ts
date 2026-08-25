import {z} from "zod";
import {DEFINITION_ID} from "./workflow-definitions.ts";
import {RESERVED_CONNECTION_KEYS} from "./workflow-connections.ts";

export const CONNECTION_ROOT="connections";
export const CONNECTION_SUFFIX=".connection.json";
export const PROVIDER_CONNECTION_SECRET_PREFIX="WORKFLOW_PROVIDER_CONNECTION_";
export const SECRET_BINDING=/^WORKFLOW_PROVIDER_CONNECTION_[A-Z0-9][A-Z0-9_]{0,79}$/;
const id=z.string().max(80).regex(DEFINITION_ID);

export const connectionDefinitionSchema=z.object({
 schemaVersion:z.literal(1),id,name:z.string().trim().min(1).max(120),runtime:z.literal("openai-responses"),provider:z.literal("openai"),model:z.string().trim().min(1).max(120),credential:z.object({secretRef:z.string().regex(SECRET_BINDING)}).strict(),
}).strict().superRefine((value,context)=>{if(RESERVED_CONNECTION_KEYS.has(value.id))context.addIssue({code:"custom",message:"Reserved connection IDs are not permitted.",path:["id"]})});
export type ConnectionDefinition=z.infer<typeof connectionDefinitionSchema>;
export const connectionDefinitionPath=(value:string)=>`${CONNECTION_ROOT}/${id.parse(value)}${CONNECTION_SUFFIX}`;

export function parseConnectionDefinition(value:unknown,path:string){
 const definition=connectionDefinitionSchema.parse(value),name=path.split("/").at(-1),expected=`${definition.id}${CONNECTION_SUFFIX}`;
 if(path!==`${CONNECTION_ROOT}/${name}`||name!==expected)throw new Error("invalid_connection_definition_identity");
 return definition;
}
