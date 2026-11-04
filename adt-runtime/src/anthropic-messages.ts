import type {AnthropicExecutionRequest} from "./protocol.js";
import {boundedProviderOutput,RuntimeFailure} from "./provider-execution.js";
import {providerPost,record,type ProviderHttpDependencies} from "./provider-http.js";

import {anthropicExecutionTimeoutMs} from "./provider-timeouts.js";
export {anthropicExecutionTimeoutMs} from "./provider-timeouts.js";
export async function executeAnthropicMessages(request:AnthropicExecutionRequest,credential:string,dependencies:ProviderHttpDependencies={}){
 const maxTokens=request.options.maxOutputTokens??4096;
 const value=await providerPost("https://api.anthropic.com/v1/messages",{authorization:`Bearer ${credential}`,"anthropic-version":"2023-06-01","content-type":"application/json",...(request.configuration?.workspaceId?{"anthropic-workspace-id":request.configuration.workspaceId}:{})},{model:request.model,system:request.instructions,messages:[{role:"user",content:request.input}],max_tokens:maxTokens},anthropicExecutionTimeoutMs(maxTokens),undefined,dependencies);
 if(!record(value)||value.type!=="message"||!Array.isArray(value.content))throw new RuntimeFailure("malformed_response","Provider returned an invalid response.");
 const parts=value.content.flatMap(block=>record(block)&&block.type==="text"&&typeof block.text==="string"?[block.text]:[]);
 if(!parts.length)throw new RuntimeFailure("malformed_response","Provider returned no textual output.");
 return boundedProviderOutput(parts.join(""));
}
