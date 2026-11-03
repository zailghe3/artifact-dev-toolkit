import type {WorkIqExecutionRequest} from "./protocol.js";
import {boundedProviderOutput,RuntimeFailure} from "./provider-execution.js";
import {providerPost,record,type ProviderHttpDependencies} from "./provider-http.js";

import {WORK_IQ_REQUEST_TIMEOUT_MS} from "./provider-timeouts.js";
export {WORK_IQ_REQUEST_TIMEOUT_MS} from "./provider-timeouts.js";
export async function executeWorkIq(request:WorkIqExecutionRequest,accessToken:string,dependencies:ProviderHttpDependencies={}){
 const headers={authorization:`Bearer ${accessToken}`,"content-type":"application/json"},endpoint="https://workiq.svc.cloud.microsoft";
 const created=await providerPost(`${endpoint}/rest/conversations`,headers,{},WORK_IQ_REQUEST_TIMEOUT_MS,201,dependencies);
 if(!record(created)||typeof created.id!=="string"||!created.id||created.id.length>256||!/^[A-Za-z0-9._-]+$/.test(created.id))throw new RuntimeFailure("malformed_response","Provider returned an invalid conversation.");
 const message=`Instructions:\n${request.instructions}\n\nWorkflow input:\n${request.input}`;
 const value=await providerPost(`${endpoint}/rest/conversations/${encodeURIComponent(created.id)}/chat`,headers,{message:{text:message},locationHint:{timeZone:request.options.timeZone},...(request.options.webGroundingEnabled===false?{contextualResources:{webContext:{isWebEnabled:false}}}:{})},WORK_IQ_REQUEST_TIMEOUT_MS,200,dependencies);
 if(!record(value))throw new RuntimeFailure("malformed_response","Provider returned an invalid response.");
 if(value.state==="disengagedForRai")throw new RuntimeFailure("provider_rejected","Provider rejected the request.");
 if(!Array.isArray(value.messages))throw new RuntimeFailure("malformed_response","Provider returned an invalid response.");
 const answer=value.messages.flatMap(item=>record(item)&&typeof item.text==="string"?[item.text]:[]).reverse().find(text=>text!==message);
 if(!answer)throw new RuntimeFailure("malformed_response","Provider returned no textual output.");
 return boundedProviderOutput(answer);
}
