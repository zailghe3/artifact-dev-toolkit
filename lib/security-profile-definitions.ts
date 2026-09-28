import {z} from "zod";
import {DEFINITION_ID} from "./workflow-definitions.ts";

export const SECURITY_PROFILE_TIMEOUT_MIN_MS=250;
export const SECURITY_PROFILE_TIMEOUT_MAX_MS=30_000;
const id=z.string().regex(DEFINITION_ID).max(80);

export function canonicalAdrianEndpoint(value:string){
 const url=new URL(value);url.hash="";url.username="";url.password="";
 if(url.protocol!=="wss:")throw new Error("security_profile_endpoint_insecure");
 url.hostname=url.hostname.toLowerCase();if(url.port==="443")url.port="";
 return url.toString();
}

export const securityProfileDefinitionSchema=z.object({schemaVersion:z.literal(1),id,name:z.string().trim().min(1).max(120),description:z.string().max(2000),provider:z.literal("adrian"),endpointUrl:z.string().url().max(2048).transform(canonicalAdrianEndpoint),decisionTimeoutMs:z.number().int().min(SECURITY_PROFILE_TIMEOUT_MIN_MS).max(SECURITY_PROFILE_TIMEOUT_MAX_MS)}).strict();
export type SecurityProfileDefinition=z.infer<typeof securityProfileDefinitionSchema>;
export type SafeSecurityProfile=SecurityProfileDefinition&{credentialConfigured:boolean};
export const SECURITY_PROFILE_ROOT="security-profiles",SECURITY_PROFILE_SUFFIX=".json";
export function securityProfilePath(value:string){return `${SECURITY_PROFILE_ROOT}/${id.parse(value)}${SECURITY_PROFILE_SUFFIX}`}
