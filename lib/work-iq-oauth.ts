import {createPkceChallenge} from "./github-app.ts";
import {constantTimeEqual,randomToken} from "./auth-core.ts";
import {WORK_IQ_SCOPES,WORK_IQ_TOKEN_TIMEOUT_MS,fetchWorkIqToken,newAuthorizationContextId,parseWorkIqPrivateBundle,serializeWorkIqPrivateBundle,workIqAuthenticationFailure} from "./work-iq-auth.ts";
import type {D1ProviderCredentialVault} from "./provider-credential-vault.ts";
export const WORK_IQ_OAUTH_TTL_MS=10*60*1000,WORK_IQ_OAUTH_CLEANUP_LIMIT=20;
type RunResult={meta?:{changes?:number}};type Statement={bind(...values:unknown[]):Statement;first<T>():Promise<T|null>;all<T>():Promise<{results?:T[]}>;run():Promise<RunResult>};type DB={prepare(sql:string):Statement};type Vault=Pick<D1ProviderCredentialVault,"create"|"delete"|"resolveWithRevision"|"replaceIfRevision">;
export type WorkIqOAuthStateRow={state_hash:string;connection_key:string;repository_revision:string;tenant_id:string;client_id:string;session_hash:string;verifier_secret_ref:string;expires_at:number;consumed_at:number|null};
async function hash(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("")}
export class WorkIqOAuthStateStore {
 private readonly db:DB;
 private readonly repositoryId?:number;
 constructor(db:DB,repositoryId?:number) { this.db=db; this.repositoryId=repositoryId; }
 private get scope() {
  return this.repositoryId===undefined?"":" AND repository_id=?";
 }
 private get repository() { return this.repositoryId===undefined?[]:[this.repositoryId]; }
 async create(input:{state:string;connectionKey:string;repositoryRevision:string;tenantId:string;clientId:string;sessionId:string;verifierSecretRef:string;expiresAt:number}) {
  const columns=this.repositoryId===undefined?"":",repository_id",value=this.repositoryId===undefined?"":",?";
  await this.db.prepare(`INSERT INTO work_iq_oauth_states(state_hash,connection_key,repository_revision,tenant_id,client_id,session_hash,verifier_secret_ref,expires_at,consumed_at${columns}) VALUES(?,?,?,?,?,?,?,?,NULL${value})`)
   .bind(await hash(input.state),input.connectionKey,input.repositoryRevision,input.tenantId,input.clientId,await hash(input.sessionId),input.verifierSecretRef,input.expiresAt,...this.repository).run();
 }
 async lookup(state:string,sessionId:string,now=Date.now()) {
  const row=await this.db.prepare("SELECT * FROM work_iq_oauth_states WHERE state_hash = ?"+this.scope).bind(await hash(state),...this.repository).first<WorkIqOAuthStateRow>();
  if(!row||row.consumed_at!==null||row.expires_at<=now||!constantTimeEqual(row.session_hash,await hash(sessionId)))throw new Error("oauth_state_invalid");
  return row;
 }
 async consume(state:string,sessionId:string,now=Date.now()) {
  const row=await this.lookup(state,sessionId,now);
  const result=await this.db.prepare("UPDATE work_iq_oauth_states SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?"+this.scope)
   .bind(now,await hash(state),now,...this.repository).run();
  if(result.meta?.changes!==1)throw new Error("oauth_state_invalid");
  return row;
 }
 async removeConsumed(state:string) {
  await this.db.prepare("DELETE FROM work_iq_oauth_states WHERE state_hash = ? AND consumed_at IS NOT NULL"+this.scope).bind(await hash(state),...this.repository).run();
 }
 async cleanup(vault:Pick<D1ProviderCredentialVault,"delete">,now=Date.now(),limit=WORK_IQ_OAUTH_CLEANUP_LIMIT) {
  const due="(expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at <= ?))";
  const rows=(await this.db.prepare("SELECT state_hash,verifier_secret_ref FROM work_iq_oauth_states WHERE "+due+this.scope+" ORDER BY expires_at LIMIT ?")
   .bind(now,now-WORK_IQ_OAUTH_TTL_MS,...this.repository,limit).all<Pick<WorkIqOAuthStateRow,"state_hash"|"verifier_secret_ref">>()).results??[];
  let cleaned=0;
  for(const row of rows){
   await vault.delete(row.verifier_secret_ref);
   const removed=await this.db.prepare("DELETE FROM work_iq_oauth_states WHERE state_hash = ? AND "+due+this.scope)
    .bind(row.state_hash,now,now-WORK_IQ_OAUTH_TTL_MS,...this.repository).run();
   if(removed.meta?.changes===1)cleaned++;
  }
  return cleaned;
 }
 async discard(state:string,sessionId:string,vault:Pick<D1ProviderCredentialVault,"delete">) {
  const row=await this.consume(state,sessionId);
  await vault.delete(row.verifier_secret_ref);
  await this.removeConsumed(state);
  return row;
 }
}
export async function beginWorkIqOAuth(input:{connectionKey:string;repositoryRevision:string;tenantId:string;clientId:string;sessionId:string;redirectUri:string},stateStore:WorkIqOAuthStateStore,vault:Vault,now=Date.now()){await stateStore.cleanup(vault,now);const state=randomToken(32),verifier=randomToken(48),verifierSecretRef=await vault.create(verifier);try{await stateStore.create({...input,state,verifierSecretRef,expiresAt:now+WORK_IQ_OAUTH_TTL_MS})}catch(error){await vault.delete(verifierSecretRef);throw error}const url=new URL(`https://login.microsoftonline.com/${input.tenantId}/oauth2/v2.0/authorize`);url.searchParams.set("client_id",input.clientId);url.searchParams.set("response_type","code");url.searchParams.set("redirect_uri",input.redirectUri);url.searchParams.set("scope",WORK_IQ_SCOPES);url.searchParams.set("state",state);url.searchParams.set("code_challenge",await createPkceChallenge(verifier));url.searchParams.set("code_challenge_method","S256");return url}
export async function completeWorkIqOAuth(input:{state:string;code:string;sessionId:string;redirectUri:string;expected:{connectionKey:string;repositoryRevision:string;tenantId:string;clientId:string;secretRef:string}},stateStore:WorkIqOAuthStateStore,vault:Vault,fetcher:typeof fetch=fetch,timeoutMs=WORK_IQ_TOKEN_TIMEOUT_MS){await stateStore.cleanup(vault);const row=await stateStore.consume(input.state,input.sessionId);let verifier:string;try{if(row.connection_key!==input.expected.connectionKey||row.repository_revision!==input.expected.repositoryRevision||row.tenant_id!==input.expected.tenantId||row.client_id!==input.expected.clientId)throw new Error("oauth_binding_changed");verifier=(await vault.resolveWithRevision(row.verifier_secret_ref)).value}finally{await vault.delete(row.verifier_secret_ref)}try{const current=await vault.resolveWithRevision(input.expected.secretRef),bundle=parseWorkIqPrivateBundle(current.value),body=new URLSearchParams({client_id:row.client_id,client_secret:bundle.clientSecret,code:input.code,code_verifier:verifier,grant_type:"authorization_code",redirect_uri:input.redirectUri,scope:WORK_IQ_SCOPES}),response=await fetchWorkIqToken(`https://login.microsoftonline.com/${row.tenant_id}/oauth2/v2.0/token`,body,fetcher,timeoutMs);if(!response.ok)throw workIqAuthenticationFailure(response.status===403?"permission_denied":response.status===429?"rate_limited":response.status>=500?"provider_unavailable":"authentication_failed");let payload:unknown;try{payload=await response.json()}catch{throw workIqAuthenticationFailure("malformed_response")};if(!payload||typeof payload!=="object"||Array.isArray(payload))throw workIqAuthenticationFailure("malformed_response");const p=payload as Record<string,unknown>;if(p.token_type!=="Bearer"||typeof p.access_token!=="string"||!p.access_token||typeof p.refresh_token!=="string"||!p.refresh_token)throw workIqAuthenticationFailure("malformed_response");const authorizationContextId=newAuthorizationContextId(),next=serializeWorkIqPrivateBundle({...bundle,refreshToken:p.refresh_token,authorizationContextId,connectedAt:new Date().toISOString()});if(!await vault.replaceIfRevision(input.expected.secretRef,current.revision,next))throw new Error("connection_revision_conflict");return authorizationContextId}finally{await stateStore.removeConsumed(input.state)}}
