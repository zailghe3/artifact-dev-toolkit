import {z} from "zod";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";
import type {ConnectionDescriptor,ResolvedConnection} from "./workflow-connections.ts";
import {normalizeProviderSafeConfiguration,requireProviderConnectionType} from "./provider-connection-types.ts";

export const WORK_IQ_SCOPE="api://workiq.svc.cloud.microsoft/WorkIQAgent.Ask";
export const WORK_IQ_SCOPES=`${WORK_IQ_SCOPE} offline_access`;
const bundleSchema=z.object({version:z.literal(1),kind:z.literal("work-iq-rest"),clientSecret:z.string().min(1).max(8192),refreshToken:z.string().min(1).max(16384).optional(),authorizationContextId:z.string().regex(/^ctx_[A-Za-z0-9_-]{32,128}$/).optional(),connectedAt:z.string().datetime().optional()}).strict().superRefine((v,c)=>{if(Boolean(v.refreshToken)!==Boolean(v.authorizationContextId))c.addIssue({code:"custom",message:"Invalid delegated authorization."})});
export type WorkIqPrivateBundle=z.infer<typeof bundleSchema>;
export function parseWorkIqPrivateBundle(value:string){let parsed:unknown;try{parsed=JSON.parse(value)}catch{throw new Error("connection_unavailable")}return bundleSchema.parse(parsed)}
export function serializeWorkIqPrivateBundle(value:WorkIqPrivateBundle){return JSON.stringify(bundleSchema.parse(value))}
export function createWorkIqPrivateBundle(clientSecret:string){return serializeWorkIqPrivateBundle({version:1,kind:"work-iq-rest",clientSecret})}
export function newAuthorizationContextId(){const bytes=crypto.getRandomValues(new Uint8Array(32));return `ctx_${Buffer.from(bytes).toString("base64url")}`}

type Vault=Pick<D1ProviderCredentialVault,"resolveWithRevision"|"replaceIfRevision">;
type Fetcher=(input:string|URL,init?:RequestInit)=>Promise<Response>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export async function redeemWorkIqRefreshToken(configuration:unknown,bundle:WorkIqPrivateBundle,fetcher:Fetcher=fetch){
 const config=normalizeProviderSafeConfiguration(requireProviderConnectionType("work-iq-rest"),configuration)!;
 if(!bundle.refreshToken||!bundle.authorizationContextId)throw new Error("connection_unavailable");
 const body=new URLSearchParams({client_id:config.clientId,client_secret:bundle.clientSecret,grant_type:"refresh_token",refresh_token:bundle.refreshToken,scope:WORK_IQ_SCOPES});
 let response:Response;try{response=await fetcher(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body})}catch{throw new Error("provider_unavailable")}
 if(!response.ok)throw new Error(response.status===401||response.status===400?"authentication_failed":"provider_unavailable");
 let payload:unknown;try{payload=await response.json()}catch{throw new Error("authentication_failed")};if(!object(payload)||typeof payload.access_token!=="string"||!payload.access_token||payload.token_type!=="Bearer")throw new Error("authentication_failed");
 return{accessToken:payload.access_token,replacementRefreshToken:typeof payload.refresh_token==="string"&&payload.refresh_token?payload.refresh_token:undefined};
}
export async function resolveWorkIqConnection(key:string,snapshot:ConnectionDescriptor,vault:Vault,fetcher:Fetcher=fetch):Promise<ResolvedConnection>{
 if(snapshot.adapter!=="work-iq-rest"||snapshot.key!==key||snapshot.management!=="git"||snapshot.credentialSource!=="adt-vault"||!snapshot.credentialSecretRef||!snapshot.authorizationContextId)throw new Error("connection_unavailable");
 const first=await vault.resolveWithRevision(snapshot.credentialSecretRef),bundle=parseWorkIqPrivateBundle(first.value);
 if(bundle.authorizationContextId!==snapshot.authorizationContextId)throw new Error("connection_unavailable");
 const token=await redeemWorkIqRefreshToken(snapshot.providerConfiguration,bundle,fetcher);
 if(token.replacementRefreshToken&&token.replacementRefreshToken!==bundle.refreshToken){const replacement=serializeWorkIqPrivateBundle({...bundle,refreshToken:token.replacementRefreshToken}),won=await vault.replaceIfRevision(snapshot.credentialSecretRef,first.revision,replacement);if(!won){const current=parseWorkIqPrivateBundle((await vault.resolveWithRevision(snapshot.credentialSecretRef)).value);if(current.authorizationContextId!==bundle.authorizationContextId)throw new Error("connection_unavailable");}}
 return{...snapshot,enabled:true,credential:token.accessToken};
}
