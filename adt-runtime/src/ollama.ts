import {Agent,fetch as nodeFetch} from "undici";
import type {OllamaExecutionRequest} from "./protocol.js";
import {assertOllamaEndpoint,type OllamaConfiguration} from "./ollama-configuration.js";
import {boundedProviderOutput,RuntimeFailure} from "./provider-execution.js";
import {providerPost,record,type ProviderHttpDependencies} from "./provider-http.js";

const fail=(category:string)=>new RuntimeFailure(category,"Ollama request failed safely.");
export function approvedOllamaConfiguration(configuration:OllamaConfiguration,allowed:ReadonlySet<string>){try{return assertOllamaEndpoint(configuration,allowed)}catch{throw fail("configuration_invalid")}}
function auth(configuration:OllamaConfiguration,credential:string):Record<string,string>{
 if(configuration.authMode==="none"){if(credential)throw fail("configuration_invalid");return{}}
 if(!credential||credential.length>8192)throw fail("configuration_invalid");
 return{authorization:`Bearer ${credential}`};
}
export async function executeOllama(request:OllamaExecutionRequest,credential:string,allowed:ReadonlySet<string>,dependencies:ProviderHttpDependencies={}){
 const configuration=approvedOllamaConfiguration(request.configuration,allowed);
 const value=await providerPost(configuration.baseUrl+"/api/chat",{"content-type":"application/json",...auth(configuration,credential)},{model:request.model,messages:[{role:"system",content:request.instructions},{role:"user",content:request.input}],stream:false,options:{num_predict:request.options.maxOutputTokens}},request.options.executionTimeoutSeconds*1000,200,{...dependencies,uncertainBodyFailure:true});
 if(!record(value)||!record(value.message)||typeof value.message.content!=="string")throw fail("malformed_response");
 return boundedProviderOutput(value.message.content);
}
export function parseOllamaModels(value:unknown):string[]{
 if(!record(value)||!Array.isArray(value.models)||value.models.length>256)throw fail("malformed_response");
 const names=value.models.map(item=>{if(!record(item)||typeof item.model!=="string"||!item.model.length||item.model.length>120||item.model!==item.model.trim()||/[\s\x00-\x1f\x7f]/.test(item.model))throw fail("malformed_response");return item.model});
 return [...new Set(names)].sort();
}
/** Read-only commissioning: uncertainty never implies an admitted chat execution. */
export async function discoverOllamaModels(configuration:OllamaConfiguration,credential:string,allowed:ReadonlySet<string>,dependencies:ProviderHttpDependencies={}){
 const safe=approvedOllamaConfiguration(configuration,allowed),headers=auth(safe,credential),timeoutMs=dependencies.timeoutMs??15_000,controller=new AbortController();
 const dispatcher=dependencies.fetcher?undefined:new Agent({headersTimeout:timeoutMs,bodyTimeout:timeoutMs});let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([(async()=>{
  let response:Response|Awaited<ReturnType<typeof nodeFetch>>;
  try{const init={method:"GET",headers,redirect:"error" as const,signal:controller.signal};response=dependencies.fetcher?await dependencies.fetcher(safe.baseUrl+"/api/tags",init):await nodeFetch(safe.baseUrl+"/api/tags",{...init,dispatcher})}catch{throw fail(controller.signal.aborted?"provider_timeout":"provider_unavailable")}
  if(!response.ok){await response.body?.cancel();throw fail(response.status===401?"authentication_failed":response.status===403?"permission_denied":response.status===429?"rate_limited":response.status>=500?"provider_unavailable":"provider_rejected")}
  if(Number(response.headers.get("content-length"))>1_100_000){await response.body?.cancel();throw fail("output_too_large")}
  const reader=response.body?.getReader();if(!reader)throw fail("malformed_response");const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1_100_000){await reader.cancel();throw fail("output_too_large")}chunks.push(value)}}catch(error){if(error instanceof RuntimeFailure)throw error;throw fail(controller.signal.aborted?"provider_timeout":"provider_unavailable")}
  let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString("utf8"))}catch{throw fail("malformed_response")}
  return parseOllamaModels(value);
 })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail("provider_timeout"))},timeoutMs)})])}finally{clearTimeout(timer);await dispatcher?.destroy().catch(()=>undefined)}
}
