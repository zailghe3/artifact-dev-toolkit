export type CodexRunnerUiOperation="connect"|"refresh"|"logout";
export interface CodexRunnerFeedback{message:string;signInUrl?:string}

export function codexRunnerFailureFeedback(status:number,value:Record<string,unknown>,operation:CodexRunnerUiOperation,origin:string):CodexRunnerFeedback{
 if(status===401){
  if(typeof value.signInUrl==="string")try{const url=new URL(value.signInUrl,origin);if(url.origin===origin&&url.pathname==="/sign-in")return{message:"Sign in to ADT to continue.",signInUrl:url.pathname+url.search}}catch{/* Ignore unvalidated URLs. */}
  return{message:"Your ADT session has expired. Sign in again."};
 }
 if(status===403)return{message:"This action was rejected. Refresh the page and try again."};
 if(operation==="connect"&&value.runnerCode==="device_auth_start_failed"){
  if(value.deviceAuthReason==="chatgpt_login_disabled"||value.deviceAuthReason==="device_auth_not_enabled")return{message:"ChatGPT device authorization is not enabled or allowed."};
  if(value.deviceAuthReason==="device_auth_upstream_forbidden"||value.deviceAuthReason==="device_auth_upstream_rejected")return{message:"OpenAI rejected the device-code request."};
  if(value.deviceAuthReason==="device_auth_rate_limited")return{message:"ChatGPT device authorization is temporarily rate limited. Try again later."};
  if(value.deviceAuthReason==="device_auth_upstream_unavailable")return{message:"The upstream authentication service is temporarily unavailable. Try again later."};
  if(value.deviceAuthReason==="device_auth_transport_error")return{message:"The Runner could not reach OpenAI authentication. Run auth diagnostics and check outbound connectivity."};
  if(value.deviceAuthReason==="device_auth_ca_configuration"||value.deviceAuthReason==="device_auth_http_client_configuration")return{message:"The Runner authentication client could not be configured. Run auth diagnostics and check its CA configuration."};
  return{message:"ChatGPT device connection could not be started. Try again."};
 }
 return{message:operation==="logout"?"ChatGPT could not be disconnected. Try again.":operation==="refresh"?"Runner status could not be refreshed.":"Codex Runner is unavailable. Try again."};
}
