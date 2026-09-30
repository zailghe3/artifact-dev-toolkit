import type {OpenAIModelError} from "./openai-models.ts";

const statuses:Record<OpenAIModelError["code"],number>={authentication_failed:401,permission_denied:403,rate_limited:429,provider_unavailable:503,provider_timeout:504,provider_request_rejected:502,malformed_response:502};

export function openAIModelDiagnosticMessage(code:OpenAIModelError["code"],status?:number) {
  if(code==="authentication_failed")return "OpenAI model discovery: authentication failed.";
  if(code==="permission_denied")return "OpenAI model discovery: permission denied.";
  if(code==="provider_timeout")return "OpenAI model discovery: timed out.";
  if(code==="provider_unavailable")return "OpenAI model discovery: temporarily unavailable.";
  if(code==="rate_limited")return "OpenAI model discovery: rate limited.";
  if(code==="provider_request_rejected")return `OpenAI model discovery: request rejected${status?` (HTTP ${status})`:""}.`;
  return "OpenAI model discovery: malformed provider response.";
}

export function openAIModelDiagnostic(code:OpenAIModelError["code"],httpStatus?:number) {
  return {status:statuses[code],body:{source:"openai" as const,safeCode:code,...(httpStatus?{httpStatus}:{}),error:openAIModelDiagnosticMessage(code,httpStatus)}};
}
