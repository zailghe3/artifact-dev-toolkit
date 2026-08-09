import type { AdapterInvocation, AdapterResult, AgentProviderAdapter, ConnectionTestResult, FailureCategory } from "./workflow-adapter.ts";
import { DeterministicTestAdapter } from "./workflow-adapter.ts";
import { openAIResponsesOptionsSchema } from "./workflow-adapter.ts";
import type { ConnectionDescriptor,ResolvedConnection } from "./workflow-connections.ts";
import {CodexCloudAdapter} from "./codex-cloud-adapter.ts";
import {UnavailableCodexCloudGateway} from "./codex-cloud-gateway.ts";

const ENDPOINT="https://api.openai.com/v1", POLL_AFTER_MS=10_000, DEFAULT_TIMEOUT_MS=30_000;
type Fetcher=(input:string|URL,init?:RequestInit)=>Promise<Response>;
type ProviderFailure=Error&{category:FailureCategory};
const failure=(category:FailureCategory):ProviderFailure=>Object.assign(new Error(category),{category});
const safeMessages:Partial<Record<FailureCategory,string>>={connection_unavailable:"Connection is not configured.",authentication_failed:"Authentication failed.",permission_denied:"Permission denied.",provider_rejected:"Configured model was rejected.",rate_limited:"Provider rate limited.",provider_unavailable:"Provider temporarily unavailable.",provider_timeout:"Connection test timed out.",malformed_response:"Provider returned an invalid response.",internal_error:"Connection test could not be completed."};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);

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
  private readonly fetcher:Fetcher;private readonly timeoutMs:number;
  constructor(fetcher:Fetcher=fetch,timeoutMs=DEFAULT_TIMEOUT_MS){this.fetcher=fetcher;this.timeoutMs=timeoutMs;}
  async validateConnection(descriptor:ConnectionDescriptor){return descriptor.enabled&&descriptor.endpoint===ENDPOINT&&Boolean(descriptor.defaultModel)?{ok:true as const}:{ok:false as const,safeMessage:"The OpenAI Responses connection is not configured."};}
  private validate(invocation:AdapterInvocation){
    const c=invocation.connection;
    if(c.adapter!==this.kind||c.endpoint!==ENDPOINT||!c.enabled||!c.defaultModel||typeof c.credential!=="string"||!c.credential.trim())throw failure("connection_unavailable");
    return openAIResponsesOptionsSchema.parse(invocation.providerOptions??{});
  }
  private async request(url:string,init:RequestInit,operation:"start"|"check"|"cancel"):Promise<Response>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(failure(operation==="start"?"provider_start_ambiguous":"provider_timeout"));},this.timeoutMs);});
    try{return await Promise.race([this.fetcher(url,{...init,signal:controller.signal}),timeout]);}
    catch{throw failure(operation==="start"?"provider_start_ambiguous":timedOut?"provider_timeout":"provider_unavailable");}
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
    const response=await this.request(`${ENDPOINT}/responses`,{method:"POST",headers:{authorization:`Bearer ${invocation.connection.credential}`,"content-type":"application/json"},body:JSON.stringify(body)},"start");
    if(!response.ok)throw this.httpFailure(response.status,"start");return this.result(await this.json(response),true) as AdapterResult;
  }
  async check(taskId:string,invocation:AdapterInvocation){
    this.validate(invocation);if(!/^resp_[A-Za-z0-9_-]+$/.test(taskId))throw failure("configuration_invalid");
    const response=await this.request(`${ENDPOINT}/responses/${taskId}`,{headers:{authorization:`Bearer ${invocation.connection.credential}`}},"check");if(!response.ok)throw this.httpFailure(response.status,"check");
    const result=this.result(await this.json(response),true);if(result.state==="pending")return {state:"pending" as const,pollAfterMs:result.pollAfterMs};return result;
  }
  async cancel(taskId:string,invocation:AdapterInvocation){
    this.validate(invocation);if(!/^resp_[A-Za-z0-9_-]+$/.test(taskId))throw failure("configuration_invalid");
    const response=await this.request(`${ENDPOINT}/responses/${taskId}/cancel`,{method:"POST",headers:{authorization:`Bearer ${invocation.connection.credential}`}},"cancel");if(!response.ok)throw this.httpFailure(response.status,"cancel");
    const value=await this.json(response);if(value.status==="cancelled")return "cancelled" as const;if(["completed","failed","incomplete"].includes(String(value.status)))return "already_terminal" as const;throw failure("malformed_response");
  }
  async testConnection(connection:ResolvedConnection):Promise<ConnectionTestResult>{
    if(connection.adapter!==this.kind||connection.endpoint!==ENDPOINT||!connection.enabled||!connection.defaultModel||typeof connection.credential!=="string"||!connection.credential.trim())return{ok:false,category:"connection_unavailable",safeMessage:safeMessages.connection_unavailable!};
    try{
      const response=await this.request(`${ENDPOINT}/responses`,{method:"POST",headers:{authorization:`Bearer ${connection.credential}`,"content-type":"application/json"},body:JSON.stringify({model:connection.defaultModel,input:"Reply exactly with OK.",store:false})},"check");
      if(!response.ok)throw this.httpFailure(response.status,"check");
      const value=await this.json(response),outputText=extractOpenAIResponseText(value)?.trim();
      if(value.status!=="completed"||!outputText)throw failure("malformed_response");
      return{ok:true,outputText:outputText.slice(0,100)};
    }catch(error){const category=error&&typeof error==="object"&&"category" in error&&typeof error.category==="string"?error.category as FailureCategory:"internal_error";return{ok:false,category,safeMessage:safeMessages[category]??safeMessages.internal_error!};}
  }
}

export function createWorkflowAdapterRegistry(fetcher:Fetcher=fetch):Map<string,AgentProviderAdapter>{const deterministic=new DeterministicTestAdapter(),openai=new OpenAIResponsesAdapter(fetcher),codex=new CodexCloudAdapter(new UnavailableCodexCloudGateway());return new Map<string,AgentProviderAdapter>([[deterministic.kind,deterministic],[openai.kind,openai],[codex.kind,codex]]);}
