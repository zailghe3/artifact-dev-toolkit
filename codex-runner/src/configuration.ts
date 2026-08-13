import { readFile } from "node:fs/promises";

export interface RunnerConfiguration { host:string; port:number; sharedSecret:string; runnerVersion:string; codexCommand:string; requestBodyLimit:number; deviceAuthCompatible:boolean;codexRespectSystemProxyExperiment?:boolean }

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
  const port=Number(environment.PORT??"8789");
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error("invalid_port");
  return{host:environment.HOST??"0.0.0.0",port,sharedSecret:await loadSecret(environment),runnerVersion:environment.CODEX_RUNNER_VERSION??"development",codexCommand:environment.CODEX_COMMAND??"codex",requestBodyLimit:16_384,deviceAuthCompatible:environment.CODEX_DEVICE_AUTH_COMPATIBLE==="1",codexRespectSystemProxyExperiment:environment.CODEX_RUNNER_CODEX_RESPECT_SYSTEM_PROXY==="1"};
}
