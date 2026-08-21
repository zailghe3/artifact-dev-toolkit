import {spawn,type ChildProcess} from "node:child_process";
import type {RunnerEnvironment} from "./environments.js";

export const SANDBOX_DIAGNOSTIC_TIMEOUT_MS=3_000;
export const SANDBOX_DIAGNOSTIC_OUTPUT_LIMIT=8_192;
export type SandboxDiagnosticReason="ok"|"sandbox_helper_unavailable"|"user_namespace_unavailable"|"uid_mapping_denied"|"pid_namespace_unavailable"|"network_namespace_unavailable"|"loopback_configuration_denied"|"proc_unavailable"|"permission_denied"|"sandbox_initialization_failed"|"timeout"|"unknown";
export interface SandboxDiagnostics{environmentKey:string;status:"available"|"unavailable"|"unknown";backend:"bubblewrap"|"unknown";reason:SandboxDiagnosticReason}
type SpawnProbe=(command:string,args:string[],options:{cwd:string;stdio:["ignore","pipe","pipe"]})=>ChildProcess;

export function classifySandboxFailure(output:string):SandboxDiagnosticReason{
 const value=output.toLowerCase();
 if(/(newuidmap|uid map|uid_map).*(denied|failed|not permitted)|failed to (write|set).*(uid|gid) map/.test(value))return"uid_mapping_denied";
 if(/(user namespace|unshare.*user|clone_newuser).*(denied|failed|not permitted|not supported)|no permissions to create new namespace/.test(value))return"user_namespace_unavailable";
 if(/(pid namespace|unshare.*pid|clone_newpid).*(denied|failed|not permitted|not supported)/.test(value))return"pid_namespace_unavailable";
 if(/(network namespace|unshare.*net|clone_newnet).*(denied|failed|not permitted|not supported)/.test(value))return"network_namespace_unavailable";
 if(/(loopback|\blo\b).*(denied|failed|not permitted|operation not permitted)/.test(value))return"loopback_configuration_denied";
 if(/(mount|open).*(\/proc)|\/proc.*(unavailable|denied|failed|not permitted)/.test(value))return"proc_unavailable";
 if(/(bubblewrap|bwrap|sandbox).*(not found|no such file)|failed to (find|start).*sandbox/.test(value))return"sandbox_helper_unavailable";
 if(/permission denied|operation not permitted/.test(value))return"permission_denied";
 if(/sandbox.*(initializ|setup|failed)|bubblewrap.*failed|bwrap.*failed/.test(value))return"sandbox_initialization_failed";
 return"unknown";
}

/** Runs Codex's pinned, model-free Linux sandbox subcommand with a fixed no-op. */
export function diagnoseSandbox(environment:RunnerEnvironment,codexCommand:string,spawnProbe:SpawnProbe=spawn,timeoutMs=SANDBOX_DIAGNOSTIC_TIMEOUT_MS):Promise<SandboxDiagnostics>{return new Promise(resolve=>{
 let settled=false,timedOut=false,output="";
 let child:ChildProcess;
 try{child=spawnProbe(codexCommand,["sandbox","linux","--","true"],{cwd:environment.cwd,stdio:["ignore","pipe","pipe"]});}catch{return resolve({environmentKey:environment.key,status:"unavailable",backend:"bubblewrap",reason:"sandbox_helper_unavailable"})}
 const finish=(reason:SandboxDiagnosticReason,status:"available"|"unavailable"|"unknown")=>{if(settled)return;settled=true;clearTimeout(timer);resolve({environmentKey:environment.key,status,backend:"bubblewrap",reason})};
 const capture=(chunk:Buffer|string)=>{if(output.length<SANDBOX_DIAGNOSTIC_OUTPUT_LIMIT)output+=(Buffer.isBuffer(chunk)?chunk.toString("utf8"):chunk).slice(0,SANDBOX_DIAGNOSTIC_OUTPUT_LIMIT-output.length)};
 child.stdout?.on("data",capture);child.stderr?.on("data",capture);
 child.on("error",error=>finish((error as NodeJS.ErrnoException).code==="ENOENT"?"sandbox_helper_unavailable":"unknown","unavailable"));
 child.on("close",code=>{if(timedOut)return finish("timeout","unavailable");if(code===0)return finish("ok","available");const reason=classifySandboxFailure(output);finish(reason,reason==="unknown"?"unknown":"unavailable")});
 const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL")},timeoutMs);
 })}
