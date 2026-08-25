import type { AdapterInvocation, AdapterResult, AgentProviderAdapter, ConnectionTestResult, FailureCategory, ProviderTransportDiagnostics } from "./workflow-adapter.ts";
import { openAIResponsesOptionsSchema } from "./workflow-adapter.ts";
import type { ConnectionDescriptor,ResolvedConnection } from "./workflow-connections.ts";
import {classifyTransportException,isLocalRuntimeTransportRejection} from "./safe-transport-exception.ts";

const ENDPOINT="https://api.openai.com/v1", POLL_AFTER_MS=10_000, DEFAULT_TIMEOUT_MS=30_000;
type Fetcher=(input:string|URL,init?:RequestInit)=>Promise<Response>;
type ProviderFailure=Error&{category:FailureCategory;transportDiagnostics?:ProviderTransportDiagnostics};
const failure=(category:FailureCategory,transportDiagnostics?:ProviderTransportDiagnostics):ProviderFailure=>Object.assign(new Error(category),{category,transportDiagnostics});
const safeMessages:Partial<Record<FailureCategory,string>>={connection_unavailable:"Connection is not configured.",authentication_failed:"Authentication failed.",permission_denied:"Permission denied.",provider_rejected:"Configured model was rejected.",rate_limited:"Provider rate limited.",provider_unavailable:"Provider temporarily unavailable.",provider_timeout:"Connection test timed out.",malformed_response:"Provider returned an invalid response.",internal_error:"Connection test could not be completed."};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const safeHeader=(value:string|null,pattern:RegExp,max:number)=>value&&value.length<=max&&pattern.test(value)?value:undefined;
async function clientRequestId(invocation:AdapterInvocation){const identity=`${invocation.runId}\0${invocation.stepId}\0${invocation.iteration}\0${invocation.attempt}\0start`,digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity));return `adt-${[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("").slice(0,40)}`;}

/** Extract only documented textual message content, preserving provider order. */
export function extractOpenAIResponseText(response:unknown):string|undefined {
  if(!object(response)||!Array.isArray(response.output))return undefined;
  const fragments:string[]=[];
  for(const item of response.output){
    if(!object(item)||item.type!=="message"||!Array.isArray(item.content))continue;
    for(const content of item.content){
      if(!object(content))continue;
      if(content.type==="output_text"&&typeof content.text==="string")fragments.push(content.text);
      else if(content.type==="refusal"&&typeof content.refusal==="string")fragments.push(content.refusal);
    }
  }
  return fragments.length?fragments.join(""):undefined;
}

export class OpenAIResponsesAdapter implements AgentProviderAdapter {
  readonly kind="openai-responses";
  private readonly injectedFetcher?:Fetcher;private readonly timeoutMs:number;
  constructor(fetcher?:Fetcher,timeoutMs=DEFAULT_TIMEOUT_MS){this.injectedFetcher=fetcher;this.timeoutMs=timeoutMs;}
  private performFetch(input:string|URL,init?:RequestInit){return (this.injectedFetcher??globalThis.fetch)(input,init);}
  async validateConnection(descriptor:ConnectionDescriptor){return descriptor.enabled&&descriptor.endpoint===ENDPOINT&&Boolean(descriptor.defaultModel)?{ok:true as const}:{ok:false as const,safeMessage:"The OpenAI Responses connection is not configured."};}
  private validate(invocation:AdapterInvocation){
    const c=invocation.connection;
    if(c.adapter!==this.kind||c.endpoint!==ENDPOINT||!c.enabled||!c.defaultModel||typeof c.credential!=="string"||!c.credential.trim())throw failure("connection_unavailable");
    return openAIResponsesOptionsSchema.parse(invocation.providerOptions??{});
  }
  private async request(url:string,init:RequestInit,operation:"start"|"check"|"cancel",clientId?:string):Promise<{response:Response;diagnostics?:ProviderTransportDiagnostics}>{
    const controller=new AbortController(),started=Date.now();let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
    const diagnostic=(outcome:ProviderTransportDiagnostics["outcome"],response?:Response,exception?:ReturnType<typeof classifyTransportException>):ProviderTransportDiagnostics|undefined=>clientId?{clientRequestId:clientId,requestId:response?safeHeader(response.headers.get("x-request-id"),/^[\x21-\x7e]+$/,255):undefined,httpStatus:response?.status,elapsedMs:Math.max(0,Date.now()-started),processingMs:response&&safeHeader(response.headers.get("openai-processing-ms"),/^\d{1,12}$/,12)!==undefined?Number(response.headers.get("openai-processing-ms")):undefined,outcome,...exception}:undefined;
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(failure(operation==="start"?"provider_start_ambiguous":"provider_timeout",diagnostic("timeout")));},this.timeoutMs);});
    try{const response=await Promise.race([this.performFetch(url,{...init,signal:controller.signal}),timeout]);return {response,diagnostics:diagnostic("response_received",response)};}
    catch(error){if(error&&typeof error==="object"&&"category" in error)throw error;const exception=classifyTransportException(error),localRuntime=isLocalRuntimeTransportRejection(exception.reason);throw failure(operation==="start"?(localRuntime?"internal_error":"provider_start_ambiguous"):timedOut?"provider_timeout":"provider_unavailable",diagnostic(timedOut?"timeout":"network_error",undefined,timedOut?undefined:exception));}
    finally{if(timer)clearTimeout(timer);}
  }
  private httpFailure(status:number,operation:"start"|"check"|"cancel"):ProviderFailure{
    if(status===401)return failure("authentication_failed");if(status===403)return failure("permission_denied");if(status===429)return failure("rate_limited");
    if(operation==="start"&&status>=500)return failure("provider_start_ambiguous");if(status>=500)return failure("provider_unavailable");
    return failure("provider_rejected");
  }
  private async json(response:Response):Promise<Record<string,unknown>>{try{const value:unknown=await response.json();if(!object(value))throw new Error();return value;}catch{throw failure("malformed_response");}}
  private result(value:Record<string,unknown>,requireId:boolean):AdapterResult|Awaited<ReturnType<AgentProviderAdapter["check"]>>{
    const id=typeof value.id==="string"&&/^resp_[A-Za-z0-9_-]+$/.test(value.id)?value.id:undefined;
    if(requireId&&!id)throw failure("malformed_response");
    if(value.status==="queued"||value.status==="in_progress"){if(!id)throw failure("malformed_response");return {state:"pending",taskId:id,pollAfterMs:POLL_AFTER_MS};}
    if(value.status==="completed"){const outputText=extractOpenAIResponseText(value);if(outputText===undefined)throw failure("malformed_response");return {state:"completed",outputText};}
    if(value.status==="failed"||value.status==="cancelled"||value.status==="incomplete")return {state:"failed",category:value.status==="cancelled"?"cancelled":"provider_rejected",retryable:false,safeMessage:"The provider response ended without completing."};
    throw failure("malformed_response");
  }
  async start(invocation:AdapterInvocation):Promise<AdapterResult>{
    const options=this.validate(invocation),body:Record<string,unknown>={model:invocation.connection.defaultModel,instructions:invocation.masterPrompt,input:invocation.inputText,background:true,store:false};
    if(options.reasoningEffort)body.reasoning={effort:options.reasoningEffort};if(options.verbosity)body.text={verbosity:options.verbosity};if(options.maxOutputTokens)body.max_output_tokens=options.maxOutputTokens;
    const clientId=await clientRequestId(invocation),{response,diagnostics}=await this.request(`${ENDPOINT}/responses`,{method:"POST",headers:{authorization:`Bearer ${invocation.connection.credential}`,"content-type":"application/json","X-Client-Request-Id":clientId},body:JSON.stringify(body)},"start",clientId);
    if(!response.ok)throw Object.assign(this.httpFailure(response.status,"start"),{transportDiagnostics:diagnostics});return {...this.result(await this.json(response),true) as AdapterResult,transportDiagnostics:diagnostics};
  }
  async check(taskId:string,invocation:AdapterInvocation){
    this.validate(invocation);if(!/^resp_[A-Za-z0-9_-]+$/.test(taskId))throw failure("configuration_invalid");
    const {response}=await this.request(`${ENDPOINT}/responses/${taskId}`,{headers:{authorization:`Bearer ${invocation.connection.credential}`}},"check");if(!response.ok)throw this.httpFailure(response.status,"check");
    const result=this.result(await this.json(response),true);if(result.state==="pending")return {state:"pending" as const,pollAfterMs:result.pollAfterMs};return result;
  }
  async cancel(taskId:string,invocation:AdapterInvocation){
    this.validate(invocation);if(!/^resp_[A-Za-z0-9_-]+$/.test(taskId))throw failure("configuration_invalid");
    const {response}=await this.request(`${ENDPOINT}/responses/${taskId}/cancel`,{method:"POST",headers:{authorization:`Bearer ${invocation.connection.credential}`}},"cancel");if(!response.ok)throw this.httpFailure(response.status,"cancel");
    const value=await this.json(response);if(value.status==="cancelled")return "cancelled" as const;if(["completed","failed","incomplete"].includes(String(value.status)))return "already_terminal" as const;throw failure("malformed_response");
  }
  async testConnection(connection:ResolvedConnection):Promise<ConnectionTestResult>{
    if(connection.adapter!==this.kind||connection.endpoint!==ENDPOINT||!connection.enabled||!connection.defaultModel||typeof connection.credential!=="string"||!connection.credential.trim())return{ok:false,category:"connection_unavailable",safeMessage:safeMessages.connection_unavailable!};
    try{
      const {response}=await this.request(`${ENDPOINT}/responses`,{method:"POST",headers:{authorization:`Bearer ${connection.credential}`,"content-type":"application/json"},body:JSON.stringify({model:connection.defaultModel,input:"Reply exactly with OK.",store:false})},"check");
      if(!response.ok)throw this.httpFailure(response.status,"check");
      const value=await this.json(response),outputText=extractOpenAIResponseText(value)?.trim();
      if(value.status!=="completed"||!outputText)throw failure("malformed_response");
      return{ok:true,outputText:outputText.slice(0,100)};
    }catch(error){const category=error&&typeof error==="object"&&"category" in error&&typeof error.category==="string"?error.category as FailureCategory:"internal_error";return{ok:false,category,safeMessage:safeMessages[category]??safeMessages.internal_error!};}
  }
}
