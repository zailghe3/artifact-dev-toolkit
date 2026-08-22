import { readFile } from "node:fs/promises";
export const JOB_REQUEST_BODY_LIMIT=1_970_000;
export const JOB_PROMPT_UTF8_LIMIT=524_320;

export type RunnerRole="integrated"|"controller"|"executor";
export interface RunnerConfiguration { role?:RunnerRole;host:string; port:number; sharedSecret?:string;executorSecret?:string;executorBaseUrl?:string;workspaceRoot?:string;redeployWebhook?:string;runnerVersion:string; codexCommand:string; requestBodyLimit:number; jobRequestBodyLimit:number; deviceAuthCompatible:boolean;environmentsFile?:string;stateDirectory:string;jobDurationMs:number }

export async function loadSecret(environment:NodeJS.ProcessEnv=process.env, read=readFile):Promise<string>{
  const direct=environment.CODEX_RUNNER_SHARED_SECRET;
  const file=environment.CODEX_RUNNER_SHARED_SECRET_FILE;
  if(direct!==undefined&&file!==undefined)throw new Error("ambiguous_shared_secret_configuration");
  let secret:string;
  if(file!==undefined){try{secret=await read(file,"utf8");}catch{throw new Error("shared_secret_file_unreadable");}secret=secret.replace(/\r?\n$/,"");}
  else if(direct!==undefined)secret=direct;
  else throw new Error("shared_secret_missing");
  if(secret.length===0)throw new Error("shared_secret_empty");
  return secret;
}
export async function loadConfiguration(environment:NodeJS.ProcessEnv=process.env):Promise<RunnerConfiguration>{
  const port=Number(environment.PORT??"8789"),jobDurationMs=Number(environment.CODEX_RUNNER_JOB_DURATION_MS??"7000000");
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error("invalid_port");if(!Number.isInteger(jobDurationMs)||jobDurationMs<1_000||jobDurationMs>7_000_000)throw new Error("invalid_job_duration");
  const role=(environment.CODEX_RUNNER_ROLE??"integrated") as RunnerRole;if(!["integrated","controller","executor"].includes(role))throw new Error("invalid_runner_role");
  const readNamed=async(directName:string,fileName:string,label:string)=>{const direct=environment[directName],file=environment[fileName];if(direct!==undefined&&file!==undefined)throw new Error(`ambiguous_${label}_configuration`);let value=direct;if(file!==undefined){try{value=(await readFile(file,"utf8")).replace(/\r?\n$/,"")}catch{throw new Error(`${label}_file_unreadable`)}}if(!value)throw new Error(`${label}_missing`);return value};
  const sharedSecret=role==="executor"?undefined:await loadSecret(environment),executorSecret=role==="integrated"?undefined:await readNamed("CODEX_RUNNER_EXECUTOR_SHARED_SECRET","CODEX_RUNNER_EXECUTOR_SHARED_SECRET_FILE","executor_secret");
  const executorBaseUrl=role==="controller"?(environment.CODEX_RUNNER_EXECUTOR_URL??"http://codex-runner-executor:8790"):undefined;if(executorBaseUrl){const url=new URL(executorBaseUrl);if(url.protocol!=="http:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw new Error("invalid_executor_url")}
  let redeployWebhook:string|undefined;if(role==="controller"&&(environment.CODEX_RUNNER_EXECUTOR_REDEPLOY_WEBHOOK||environment.CODEX_RUNNER_EXECUTOR_REDEPLOY_WEBHOOK_FILE))redeployWebhook=await readNamed("CODEX_RUNNER_EXECUTOR_REDEPLOY_WEBHOOK","CODEX_RUNNER_EXECUTOR_REDEPLOY_WEBHOOK_FILE","executor_redeploy_webhook");
  return{role,host:environment.HOST??"0.0.0.0",port,sharedSecret,executorSecret,executorBaseUrl,workspaceRoot:environment.CODEX_RUNNER_WORKSPACE_ROOT??"/workspaces",redeployWebhook,runnerVersion:environment.CODEX_RUNNER_VERSION??"development",codexCommand:environment.CODEX_COMMAND??"codex",requestBodyLimit:16_384,jobRequestBodyLimit:JOB_REQUEST_BODY_LIMIT,deviceAuthCompatible:environment.CODEX_DEVICE_AUTH_COMPATIBLE==="1",environmentsFile:environment.CODEX_RUNNER_ENVIRONMENTS_FILE,stateDirectory:environment.CODEX_RUNNER_STATE_DIR??"/data/runner",jobDurationMs};
}
