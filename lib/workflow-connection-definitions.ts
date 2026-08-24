import {z} from "zod";
import {DEFINITION_ID} from "./workflow-definitions.ts";

export const CONNECTION_ROOT="connections";
export const CONNECTION_SUFFIX=".connection.json";
export const SECRET_BINDING=/^[A-Z][A-Z0-9_]{0,127}$/;
const id=z.string().max(80).regex(DEFINITION_ID);

export const connectionDefinitionSchema=z.object({
 schemaVersion:z.literal(1),id,name:z.string().trim().min(1).max(120),runtime:z.literal("openai-responses"),provider:z.literal("openai"),model:z.string().trim().min(1).max(120),credential:z.object({secretRef:z.string().regex(SECRET_BINDING)}).strict(),
}).strict();
export type ConnectionDefinition=z.infer<typeof connectionDefinitionSchema>;
export const connectionDefinitionPath=(value:string)=>`${CONNECTION_ROOT}/${id.parse(value)}${CONNECTION_SUFFIX}`;

export function parseConnectionDefinition(value:unknown,path:string){
 const definition=connectionDefinitionSchema.parse(value),name=path.split("/").at(-1),expected=`${definition.id}${CONNECTION_SUFFIX}`;
 if(path!==`${CONNECTION_ROOT}/${name}`||name!==expected)throw new Error("invalid_connection_definition_identity");
 return definition;
}
