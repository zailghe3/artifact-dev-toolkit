import {CodexRunnerError,type RunnerOperationError} from "./codex-runner-client";

export type RunnerActionStage="device_auth_start"|"logout";

export function runnerActionFailure(stage:RunnerActionStage,error:unknown,logger:(message:string)=>void=console.error){
 const category=error instanceof CodexRunnerError?error.category:"runner_unavailable";
 const runnerCode:RunnerOperationError|undefined=error instanceof CodexRunnerError?error.runnerCode:undefined;
 const details=error instanceof CodexRunnerError?error.details:{};
 logger(JSON.stringify({event:"codex_runner_action_failed",stage,category,...(error instanceof CodexRunnerError&&error.transport?{transport:error.transport}:{}),...(runnerCode?{runnerCode}:{}),...details}));
 return{error:category,...(runnerCode?{runnerCode}:{}),...details};
}
