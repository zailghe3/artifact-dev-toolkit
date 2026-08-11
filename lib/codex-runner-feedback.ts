export type CodexRunnerUiOperation="connect"|"refresh"|"logout";
export interface CodexRunnerFeedback{message:string;signInUrl?:string}

export function codexRunnerFailureFeedback(status:number,value:Record<string,unknown>,operation:CodexRunnerUiOperation,origin:string):CodexRunnerFeedback{
 if(status===401){
  if(typeof value.signInUrl==="string")try{const url=new URL(value.signInUrl,origin);if(url.origin===origin&&url.pathname==="/sign-in")return{message:"Sign in to ADT to continue.",signInUrl:url.pathname+url.search}}catch{/* Ignore unvalidated URLs. */}
  return{message:"Your ADT session has expired. Sign in again."};
 }
 if(status===403)return{message:"This action was rejected. Refresh the page and try again."};
 if(operation==="connect"&&value.runnerCode==="device_auth_start_failed")return{message:"ChatGPT device connection could not be started. Try again."};
 return{message:operation==="logout"?"ChatGPT could not be disconnected. Try again.":operation==="refresh"?"Runner status could not be refreshed.":"Codex Runner is unavailable. Try again."};
}
