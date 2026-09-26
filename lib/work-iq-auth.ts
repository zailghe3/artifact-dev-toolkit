import {z} from "zod";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";
import type {ConnectionDescriptor,ResolvedConnection} from "./workflow-connections.ts";
import {normalizeProviderSafeConfiguration,requireProviderConnectionType} from "./provider-connection-types.ts";
import type {FailureCategory} from "./workflow-adapter.ts";

export const WORK_IQ_SCOPE="api://workiq.svc.cloud.microsoft/WorkIQAgent.Ask";
export const WORK_IQ_SCOPES=`${WORK_IQ_SCOPE} offline_access`;
export const WORK_IQ_TOKEN_TIMEOUT_MS=15_000;
const bundleSchema=z.object({version:z.literal(1),kind:z.literal("work-iq-rest"),clientSecret:z.string().min(1).max(8192),refreshToken:z.string().min(1).max(16384).optional(),authorizationContextId:z.string().regex(/^ctx_[A-Za-z0-9_-]{32,128}$/).optional(),connectedAt:z.string().datetime().optional()}).strict().superRefine((v,c)=>{if(Boolean(v.refreshToken)!==Boolean(v.authorizationContextId))c.addIssue({code:"custom",message:"Invalid delegated authorization."})});
export type WorkIqPrivateBundle=z.infer<typeof bundleSchema>;
export function parseWorkIqPrivateBundle(value:string){let parsed:unknown;try{parsed=JSON.parse(value)}catch{throw new Error("connection_unavailable")}return bundleSchema.parse(parsed)}
export function serializeWorkIqPrivateBundle(value:WorkIqPrivateBundle){return JSON.stringify(bundleSchema.parse(value))}
export function createWorkIqPrivateBundle(clientSecret:string){return serializeWorkIqPrivateBundle({version:1,kind:"work-iq-rest",clientSecret})}
export function newAuthorizationContextId(){const bytes=crypto.getRandomValues(new Uint8Array(32));return `ctx_${Buffer.from(bytes).toString("base64url")}`}

export class WorkIqAuthenticationFailure extends Error{readonly category:FailureCategory;constructor(category:FailureCategory){super(category);this.category=category}}
export const workIqAuthenticationFailure=(category:FailureCategory)=>new WorkIqAuthenticationFailure(category);
type Vault=Pick<D1ProviderCredentialVault,"resolveWithRevision"|"replaceIfRevision">;
type Fetcher=(input:string|URL,init?:RequestInit)=>Promise<Response>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export async function fetchWorkIqToken(url:string,body:URLSearchParams,fetcher:Fetcher=fetch,timeoutMs=WORK_IQ_TOKEN_TIMEOUT_MS){
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
 try{const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(workIqAuthenticationFailure("provider_timeout"))},timeoutMs)});try{return await Promise.race([fetcher(url,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body,signal:controller.signal}),timeout])}catch(error){if(error instanceof WorkIqAuthenticationFailure)throw error;throw workIqAuthenticationFailure(timedOut?"provider_timeout":"provider_unavailable")}}finally{if(timer)clearTimeout(timer)}
}
function tokenHttpFailure(status:number){if(status===400||status===401)return workIqAuthenticationFailure("authentication_failed");if(status===403)return workIqAuthenticationFailure("permission_denied");if(status===429)return workIqAuthenticationFailure("rate_limited");return workIqAuthenticationFailure(status>=500?"provider_unavailable":"configuration_invalid")}
export async function redeemWorkIqRefreshToken(configuration:unknown,bundle:WorkIqPrivateBundle,fetcher:Fetcher=fetch,timeoutMs=WORK_IQ_TOKEN_TIMEOUT_MS){
 let config:Readonly<Record<string,string>>;try{config=normalizeProviderSafeConfiguration(requireProviderConnectionType("work-iq-rest"),configuration)!}catch{throw workIqAuthenticationFailure("configuration_invalid")}
 if(!bundle.refreshToken||!bundle.authorizationContextId)throw workIqAuthenticationFailure("connection_unavailable");
 const body=new URLSearchParams({client_id:config.clientId,client_secret:bundle.clientSecret,grant_type:"refresh_token",refresh_token:bundle.refreshToken,scope:WORK_IQ_SCOPES}),response=await fetchWorkIqToken(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,body,fetcher,timeoutMs);
 if(!response.ok)throw tokenHttpFailure(response.status);
 let payload:unknown;try{payload=await response.json()}catch{throw workIqAuthenticationFailure("malformed_response")};if(!object(payload)||typeof payload.access_token!=="string"||!payload.access_token||payload.token_type!=="Bearer")throw workIqAuthenticationFailure("malformed_response");
 return{accessToken:payload.access_token,replacementRefreshToken:typeof payload.refresh_token==="string"&&payload.refresh_token?payload.refresh_token:undefined};
}
function assertWorkIqSnapshot(key:string,snapshot:ConnectionDescriptor){if(snapshot.adapter!=="work-iq-rest"||snapshot.key!==key||snapshot.management!=="git"||snapshot.credentialSource!=="adt-vault"||!snapshot.credentialSecretRef||!snapshot.authorizationContextId)throw workIqAuthenticationFailure("connection_unavailable")}
export async function resolveWorkIqSnapshotAuthorization(key:string,snapshot:ConnectionDescriptor,vault:Pick<D1ProviderCredentialVault,"resolveWithRevision">):Promise<ConnectionDescriptor>{assertWorkIqSnapshot(key,snapshot);let bundle:WorkIqPrivateBundle;try{bundle=parseWorkIqPrivateBundle((await vault.resolveWithRevision(snapshot.credentialSecretRef!)).value)}catch{throw workIqAuthenticationFailure("connection_unavailable")}if(!bundle.refreshToken||!bundle.authorizationContextId||bundle.authorizationContextId!==snapshot.authorizationContextId)throw workIqAuthenticationFailure("connection_unavailable");return{...snapshot,enabled:true}}
export async function assertWorkIqConfigurationMutable(secretRef:string,vault:Pick<D1ProviderCredentialVault,"resolveWithRevision">){let bundle:WorkIqPrivateBundle;try{bundle=parseWorkIqPrivateBundle((await vault.resolveWithRevision(secretRef)).value)}catch{throw workIqAuthenticationFailure("connection_unavailable")}if(bundle.refreshToken||bundle.authorizationContextId)throw new Error("delegated_account_disconnect_required")}
export async function resolveWorkIqConnection(key:string,snapshot:ConnectionDescriptor,vault:Vault,fetcher:Fetcher=fetch,timeoutMs=WORK_IQ_TOKEN_TIMEOUT_MS):Promise<ResolvedConnection>{
 assertWorkIqSnapshot(key,snapshot);let first:{value:string;revision:number},bundle:WorkIqPrivateBundle;try{first=await vault.resolveWithRevision(snapshot.credentialSecretRef!);bundle=parseWorkIqPrivateBundle(first.value)}catch{throw workIqAuthenticationFailure("connection_unavailable")}
 if(!bundle.refreshToken||bundle.authorizationContextId!==snapshot.authorizationContextId)throw workIqAuthenticationFailure("connection_unavailable");
 const token=await redeemWorkIqRefreshToken(snapshot.providerConfiguration,bundle,fetcher,timeoutMs);
 if(token.replacementRefreshToken){const replacement=serializeWorkIqPrivateBundle({...bundle,refreshToken:token.replacementRefreshToken});await vault.replaceIfRevision(snapshot.credentialSecretRef!,first.revision,replacement)}
 let current:WorkIqPrivateBundle;try{current=parseWorkIqPrivateBundle((await vault.resolveWithRevision(snapshot.credentialSecretRef!)).value)}catch{throw workIqAuthenticationFailure("connection_unavailable")}
 if(!current.refreshToken||current.authorizationContextId!==snapshot.authorizationContextId)throw workIqAuthenticationFailure("connection_unavailable");
 return{...snapshot,enabled:true,credential:token.accessToken};
}
