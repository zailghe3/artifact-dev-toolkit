import type {ProviderExecutionRequest} from "./protocol.js";
import {executeOpenAIAgents,type Factories} from "./openai-agents.js";
import {executeAnthropicMessages,anthropicExecutionTimeoutMs} from "./anthropic-messages.js";
import {executeWorkIq,WORK_IQ_REQUEST_TIMEOUT_MS} from "./work-iq.js";
import type {ProviderHttpDependencies} from "./provider-http.js";

import {executeOllama} from "./ollama.js";

type Dependencies={ollamaAllowedBaseUrls?:ReadonlySet<string>;openai?:Partial<Factories>;http?:ProviderHttpDependencies;onProviderEntry:()=>void};
type ProviderExecutors={[K in ProviderExecutionRequest["capability"]]:(request:Extract<ProviderExecutionRequest,{capability:K}>,credential:string,dependencies:Dependencies)=>Promise<string>};
const executors:ProviderExecutors={
 "ollama-chat":(request,credential,dependencies)=>executeOllama(request,credential,dependencies.ollamaAllowedBaseUrls??new Set(),{...dependencies.http,onProviderEntry:dependencies.onProviderEntry}),
 "openai-agents":(request,credential,dependencies)=>{dependencies.onProviderEntry();return executeOpenAIAgents(request,credential,dependencies.openai)},
 "anthropic-messages":(request,credential,dependencies)=>executeAnthropicMessages(request,credential,{...dependencies.http,onProviderEntry:dependencies.onProviderEntry}),
 "work-iq-rest":(request,credential,dependencies)=>executeWorkIq(request,credential,{...dependencies.http,onProviderEntry:dependencies.onProviderEntry}),
};
export const PROVIDER_CAPABILITIES=Object.keys(executors);
export function executeProvider(request:ProviderExecutionRequest,credential:string,dependencies:Dependencies){
 // Narrow the discriminated union before handing execution authority to an executor.
 switch(request.capability){
  case "ollama-chat":return executors[request.capability](request,credential,dependencies);
  case "openai-agents":return executors[request.capability](request,credential,dependencies);
  case "anthropic-messages":return executors[request.capability](request,credential,dependencies);
  case "work-iq-rest":return executors[request.capability](request,credential,dependencies);
 }
}
export function providerExecutionTimeoutMs(request:ProviderExecutionRequest){
 switch(request.capability){
  case "ollama-chat":return request.options.executionTimeoutSeconds*1000;
  case "openai-agents":return request.executionTimeoutMs;
  case "anthropic-messages":return anthropicExecutionTimeoutMs(request.options.maxOutputTokens);
  case "work-iq-rest":return WORK_IQ_REQUEST_TIMEOUT_MS*2;
 }
}
