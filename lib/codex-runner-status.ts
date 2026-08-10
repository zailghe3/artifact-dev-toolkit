import {CodexRunnerError,getCodexRunnerClient,type RunnerAuthStatus,type RunnerCapabilities} from "./codex-runner-client";

export type CodexConnectionState="configuration-missing"|"unavailable"|"update-required"|"disconnected"|"waiting"|"connected";
export interface SafeCodexConnectionStatus{state:CodexConnectionState;label:string;capabilities?:RunnerCapabilities;auth?:RunnerAuthStatus}

type StatusStage="configuration"|"capabilities"|"auth_status";
type StatusClient=Pick<ReturnType<typeof getCodexRunnerClient>,"capabilities"|"authStatus">;
type StatusLogger=(message:string)=>void;
type StatusDependencies={clientFactory?:()=>StatusClient;logger?:StatusLogger};

function errorCategory(error:unknown){
 return error instanceof CodexRunnerError?error.category:"runner_unavailable";
}

function logFailure(logger:StatusLogger,stage:StatusStage,error:unknown){
 logger(JSON.stringify({event:"codex_runner_status_failed",stage,category:errorCategory(error),...(error instanceof CodexRunnerError&&error.transport?{transport:error.transport}:{})}));
}

function safeFailureStatus(error:unknown):SafeCodexConnectionStatus{
 if(error instanceof CodexRunnerError&&error.category==="configuration_missing")return{state:"configuration-missing",label:"Runner configuration missing"};
 if(error instanceof CodexRunnerError&&error.category==="runner_update_required")return{state:"update-required",label:"Runner update required"};
 return{state:"unavailable",label:"Runner unavailable"};
}

export async function getSafeCodexConnectionStatus(dependencies:StatusDependencies={}):Promise<SafeCodexConnectionStatus>{
 const logger=dependencies.logger??console.error;
 let client:StatusClient;
 try{client=(dependencies.clientFactory??getCodexRunnerClient)();}
 catch(error){logFailure(logger,"configuration",error);return safeFailureStatus(error)}

 let capabilities:RunnerCapabilities;
 try{capabilities=await client.capabilities();}
 catch(error){logFailure(logger,"capabilities",error);return safeFailureStatus(error)}

 if(!capabilities.codexAvailable)return{state:"unavailable",label:"Runner unavailable",capabilities};
 if(!capabilities.deviceAuth)return{state:"update-required",label:"Runner update required",capabilities};

 let auth:RunnerAuthStatus;
 try{auth=await client.authStatus();}
 catch(error){logFailure(logger,"auth_status",error);return safeFailureStatus(error)}
 return auth.connected?{state:"connected",label:"Connected to ChatGPT",capabilities,auth}:{state:"disconnected",label:"Runner ready — ChatGPT not connected",capabilities,auth};
}
