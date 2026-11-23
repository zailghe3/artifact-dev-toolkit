import type {AnthropicExecutionRequest} from "./protocol.js";
import {boundedProviderOutput,RuntimeFailure} from "./provider-execution.js";
import {providerPost,record,type ProviderHttpDependencies} from "./provider-http.js";

import {anthropicExecutionTimeoutMs} from "./provider-timeouts.js";
export {anthropicExecutionTimeoutMs} from "./provider-timeouts.js";
export async function executeAnthropicMessages(request:AnthropicExecutionRequest,credential:string,dependencies:ProviderHttpDependencies={}){
 const maxTokens=request.options.maxOutputTokens??4096;
 const value=await providerPost("https://api.anthropic.com/v1/messages",{authorization:`Bearer ${credential}`,"anthropic-version":"2023-06-01","content-type":"application/json",...(request.configuration?.workspaceId?{"anthropic-workspace-id":request.configuration.workspaceId}:{})},{model:request.model,system:request.instructions,messages:[{role:"user",content:request.input}],max_tokens:maxTokens},anthropicExecutionTimeoutMs(maxTokens),undefined,{...dependencies,classifyRejection:anthropicMessagesRejection});
 if(!record(value)||value.type!=="message"||!Array.isArray(value.content))throw new RuntimeFailure("malformed_response","Provider returned an invalid response.");
 const parts=value.content.flatMap(block=>record(block)&&block.type==="text"&&typeof block.text==="string"?[block.text]:[]);
 if(!parts.length)throw new RuntimeFailure("malformed_response","Provider returned no textual output.");
 return boundedProviderOutput(parts.join(""));
}

export function anthropicMessagesRejection(status:number,body:unknown){
 if(!record(body)||!record(body.error))return;
 const {type,message}=body.error;
 if(status===404&&type==="not_found_error"&&typeof message==="string"&&/^model:/i.test(message))
  return new RuntimeFailure("model_unavailable","The selected model is unavailable to this Anthropic account or workspace. Load the available models for this connection.");
 if(status!==400||type!=="invalid_request_error"||typeof message!=="string")return;
 if(/(?:model (?:does not|doesn't) support (?:tools|tool use)|tool use is not supported (?:by|for) (?:this|the) model)/i.test(message))
  return new RuntimeFailure("tool_proposals_unsupported","Anthropic reported that the selected model does not support tools. Select another model or remove tool grants for this block.");
 if(/^max_tokens[: ]/.test(message))
  return new RuntimeFailure("unsupported_model_option","Anthropic rejected the maximum output tokens. Adjust the Agent’s token setting or choose another model.");
}
