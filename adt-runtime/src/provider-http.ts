import {RuntimeFailure} from "./provider-execution.js";
import {Agent,fetch as nodeFetch} from "undici";

export type ProviderHttpDependencies={fetcher?:typeof fetch;timeoutMs?:number;onProviderEntry?:()=>void;uncertainBodyFailure?:boolean;classifyRejection?:(status:number,body:unknown)=>RuntimeFailure|undefined};
export const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const fail=(category:string)=>new RuntimeFailure(category,"Provider execution failed safely.");
export function providerHttpFailure(status:number){
 return fail(status===401?"authentication_failed":status===403?"permission_denied":status===429?"rate_limited":[400,404,405,413,415,422].includes(status)?"provider_rejected":"provider_start_ambiguous");
}
/** One mutation, with no retries. The deadline covers headers and body consumption. */
export async function providerPost(url:string,headers:Record<string,string>,body:unknown,timeoutMs:number,expectedStatus:number|undefined,dependencies:ProviderHttpDependencies){
 // Node fetch's default header deadline is shorter than Anthropic execution.
 const dispatcher=dependencies.fetcher?undefined:new Agent({headersTimeout:timeoutMs+1000,bodyTimeout:timeoutMs+1000});
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let httpFailure:RuntimeFailure|undefined;
 try{
  return await Promise.race([(async()=>{
   dependencies.onProviderEntry?.();
   let response:Response|Awaited<ReturnType<typeof nodeFetch>>;
   const init={method:"POST",headers,body:JSON.stringify(body),signal:controller.signal,redirect:"error" as const};
   try{response=dependencies.fetcher?await dependencies.fetcher(url,init):await nodeFetch(url,{...init,dispatcher})}
   catch{throw fail("provider_start_ambiguous")}
   if(!response.ok){
    httpFailure=providerHttpFailure(response.status);
    let rejection:RuntimeFailure|undefined;
    if(dependencies.classifyRejection&&(response.status===400||response.status===404)){
     const payload=await readProviderJson(response,8192,false).catch(()=>undefined);
     rejection=dependencies.classifyRejection(response.status,payload);
    }else await response.body?.cancel().catch(()=>undefined);
    throw rejection??httpFailure;
   }
   if(expectedStatus!==undefined&&response.status!==expectedStatus)throw fail("malformed_response");
   return readProviderJson(response,1_100_000,dependencies.uncertainBodyFailure===true);
  })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(httpFailure??fail("provider_start_ambiguous"))},dependencies.timeoutMs??timeoutMs)})]);
 }finally{clearTimeout(timer);await dispatcher?.destroy().catch(()=>undefined)}
}

async function readProviderJson(response:Response|Awaited<ReturnType<typeof nodeFetch>>,maxBytes:number,uncertainBodyFailure:boolean){
 if(Number(response.headers.get("content-length"))>maxBytes){await response.body?.cancel().catch(()=>undefined);throw fail("output_too_large")}
 const reader=response.body?.getReader();if(!reader)throw fail("malformed_response");
 const chunks:Uint8Array[]=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes){await reader.cancel().catch(()=>undefined);throw fail("output_too_large")}chunks.push(value)}}
 catch(error){if(error instanceof RuntimeFailure)throw error;throw fail(uncertainBodyFailure?"provider_start_ambiguous":"malformed_response")}
 try{return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown}catch{throw fail("malformed_response")}
}
