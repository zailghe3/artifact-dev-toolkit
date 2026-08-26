import { createHash, createHmac, timingSafeEqual, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

export const PROTOCOL_VERSION = "adt-runtime-v1";
export const EXECUTE_PATH = "/v1/executions/openai-agents";
export const READINESS_PATH = "/v1/readiness";
export const MAX_BODY_BYTES = 1_100_000;
export const MAX_RESPONSE_BYTES = 300_000;
export const AUTH_WINDOW_MS = 5 * 60_000;
export const MAX_NONCES = 10_000;
const text = new TextEncoder();

const bounded = (max: number) => z.string().min(1).max(max);
export const envelopeSchema = z.object({
  version: z.literal(1), keyId: bounded(128), algorithm: z.literal("RSA-OAEP-256+A256GCM"),
  wrappedKey: bounded(2048), nonce: bounded(64), ciphertext: bounded(16_384),
}).strict();
export const executionSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION), capability: z.literal("openai-agents"),
  requestId: bounded(128), idempotencyKey: bounded(256), agentName: bounded(160),
  instructions: bounded(262_144), input: bounded(262_144), model: bounded(120),
  options: z.object({reasoningEffort:z.enum(["none","low","medium","high","xhigh","max"]).optional(),verbosity:z.enum(["low","medium","high"]).optional(),maxOutputTokens:z.number().int().positive().max(262_144).optional()}).strict(),
  credential: envelopeSchema,
}).strict();
export type ExecutionRequest = z.infer<typeof executionSchema>;

export function sha256(value: Uint8Array | string) { return createHash("sha256").update(value).digest("base64url"); }
export function canonical(method:string,path:string,timestamp:string,nonce:string,digest:string) {
  return [PROTOCOL_VERSION, method.toUpperCase(), path, timestamp, nonce, digest].join("\n");
}
export function signature(secret:string, method:string,path:string,timestamp:string,nonce:string,digest:string) {
  return createHmac("sha256",secret).update(canonical(method,path,timestamp,nonce,digest)).digest("base64url");
}

export class ReplayCache {
  private values = new Map<string,number>();
  constructor(readonly max=MAX_NONCES, readonly windowMs=AUTH_WINDOW_MS) {}
  accept(nonce:string, now=Date.now()) {
    for(const [key,expires] of this.values) if(expires<=now)this.values.delete(key);
    if(this.values.has(nonce))return false;
    while(this.values.size>=this.max)this.values.delete(this.values.keys().next().value!);
    this.values.set(nonce,now+this.windowMs); return true;
  }
  get size(){return this.values.size;}
}

export function authenticate(headers:Record<string,string|string[]|undefined>,method:string,path:string,body:Uint8Array,secret:string,replays:ReplayCache,now=Date.now()) {
  const get=(name:string)=>typeof headers[name]==="string"?headers[name]:"";
  const version=get("x-adt-protocol"),timestamp=get("x-adt-timestamp"),nonce=get("x-adt-nonce"),digest=get("x-adt-content-sha256"),provided=get("x-adt-signature");
  if(version!==PROTOCOL_VERSION||!/^\d{13}$/.test(timestamp)||!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)||!digest||!provided)return false;
  if(Math.abs(now-Number(timestamp))>AUTH_WINDOW_MS||digest!==sha256(body))return false;
  const expected=signature(secret,method,path,timestamp,nonce,digest),a=Buffer.from(expected),b=Buffer.from(provided);
  if(a.length!==b.length||!timingSafeEqual(a,b))return false;
  return replays.accept(nonce,now);
}

function fromB64(value:string){return Buffer.from(value,"base64url");}
function pemDer(pem:string,label:string){const body=pem.replace(`-----BEGIN ${label}-----`,"").replace(`-----END ${label}-----`,"").replace(/\s/g,"");return Buffer.from(body,"base64");}
export async function importPrivateKey(pem:string){return webcrypto.subtle.importKey("pkcs8",pemDer(pem,"PRIVATE KEY"),{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt"]);}
export async function keyIdForPrivateKey(_key:CryptoKey, configured:string){return configured;}
export async function decryptCredential(envelope:z.infer<typeof envelopeSchema>,privateKey:Awaited<ReturnType<typeof importPrivateKey>>,keyId:string,aad:string){
  const parsed=envelopeSchema.parse(envelope); if(parsed.keyId!==keyId)throw new Error("credential_envelope_invalid");
  try{
    const raw=await webcrypto.subtle.decrypt({name:"RSA-OAEP"},privateKey,fromB64(parsed.wrappedKey));
    const key=await webcrypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["decrypt"]);
    const clear=await webcrypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(parsed.nonce),additionalData:text.encode(aad),tagLength:128},key,fromB64(parsed.ciphertext));
    const credential=new TextDecoder().decode(clear);if(!credential||credential.length>8192)throw new Error();return credential;
  }catch{throw new Error("credential_envelope_invalid");}
}
export function secretValue(name:string){const file=process.env[`${name}_FILE`];const value=file?readFileSync(file,"utf8").trim():process.env[name]?.trim();if(!value)throw new Error(`${name.toLowerCase()}_missing`);return value;}
