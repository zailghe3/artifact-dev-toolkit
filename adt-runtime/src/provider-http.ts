import {RuntimeFailure} from "./provider-execution.js";
import {Agent,fetch as nodeFetch} from "undici";

export type ProviderHttpDependencies={fetcher?:typeof fetch;timeoutMs?:number;onProviderEntry?:()=>void};
export const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const fail=(category:string)=>new RuntimeFailure(category,"Provider execution failed safely.");
export function providerHttpFailure(status:number){
 return fail(status===401?"authentication_failed":status===403?"permission_denied":status===429?"rate_limited":status>=500?"provider_start_ambiguous":"provider_rejected");
}
/** One mutation, with no retries. The deadline covers headers and body consumption. */
export async function providerPost(url:string,headers:Record<string,string>,body:unknown,timeoutMs:number,expectedStatus:number|undefined,dependencies:ProviderHttpDependencies){
 // Node fetch's default header deadline is shorter than Anthropic execution.
 const dispatcher=dependencies.fetcher?undefined:new Agent({headersTimeout:timeoutMs+1000,bodyTimeout:timeoutMs+1000});
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([(async()=>{
   dependencies.onProviderEntry?.();
   let response:Response|Awaited<ReturnType<typeof nodeFetch>>;
   const init={method:"POST",headers,body:JSON.stringify(body),signal:controller.signal,redirect:"error" as const};
   try{response=dependencies.fetcher?await dependencies.fetcher(url,init):await nodeFetch(url,{...init,dispatcher})}
   catch{throw fail("provider_start_ambiguous")}
   if(!response.ok)throw providerHttpFailure(response.status);
   if(expectedStatus!==undefined&&response.status!==expectedStatus)throw fail("malformed_response");
   // Bound upstream memory as well as the final textual output.
   const reader=response.body?.getReader();if(!reader)throw fail("malformed_response");
   const chunks:Uint8Array[]=[];let bytes=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1_100_000){await reader.cancel();throw fail("output_too_large")}chunks.push(value)}}
   catch(error){if(error instanceof RuntimeFailure)throw error;throw fail("malformed_response")}
   try{return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown}catch{throw fail("malformed_response")}
  })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail("provider_start_ambiguous"))},dependencies.timeoutMs??timeoutMs)})]);
 }finally{clearTimeout(timer);await dispatcher?.destroy().catch(()=>undefined)}
}
