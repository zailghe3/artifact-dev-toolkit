import {access,mkdir,open,readFile,realpath,rm,stat} from "node:fs/promises";
import {constants} from "node:fs";
import {isAbsolute,join} from "node:path";
import {randomBytes} from "node:crypto";
import {execFile} from "node:child_process";

export type RunnerSandbox="read-only"|"workspace-write";
export interface RunnerEnvironment{key:string;name:string;cwd:string;enabled:boolean;sandbox:RunnerSandbox;ready:boolean}
export interface PublicRunnerEnvironment{key:string;name:string;enabled:boolean;ready:boolean;sandbox:RunnerSandbox}
export interface WorkspaceDiagnostics{environmentKey:string;filesystemReady:boolean;gitAvailable:boolean;gitRepository:boolean;headCommit:string|null;dirty:boolean|null}
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).every(key=>keys.includes(key))&&keys.every(key=>Object.hasOwn(value,key));

export async function loadRunnerEnvironments(file:string|undefined):Promise<RunnerEnvironment[]>{
 if(!file)return[];
 let parsed:unknown;try{parsed=JSON.parse(await readFile(file,"utf8"));}catch{throw new Error("invalid_environments_configuration")}
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||!exact(parsed as Record<string,unknown>,["schemaVersion","environments"])||(parsed as Record<string,unknown>).schemaVersion!==1||!Array.isArray((parsed as Record<string,unknown>).environments)||(parsed as {environments:unknown[]}).environments.length>100)throw new Error("invalid_environments_configuration");
 const keys=new Set<string>(),result:RunnerEnvironment[]=[];
 for(const raw of (parsed as {environments:unknown[]}).environments){
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||!exact(raw as Record<string,unknown>,["key","name","cwd","enabled","sandbox"]))throw new Error("invalid_environments_configuration");
  const {key,name,cwd,enabled,sandbox}=raw as Record<string,unknown>;
  if(typeof key!=="string"||key.length>80||!ID.test(key)||keys.has(key)||typeof name!=="string"||!name.trim()||name.length>120||typeof cwd!=="string"||!isAbsolute(cwd)||typeof enabled!=="boolean"||(sandbox!=="read-only"&&sandbox!=="workspace-write"))throw new Error("invalid_environments_configuration");
  keys.add(key);let canonical:string;try{canonical=await realpath(cwd);if(!(await stat(canonical)).isDirectory())throw new Error()}catch{throw new Error("invalid_environments_configuration")}
  result.push({key,name:name.trim(),cwd:canonical,enabled,sandbox,ready:enabled?await readiness(canonical,sandbox):false});
 }
 return result.sort((a,b)=>a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
}
async function readiness(cwd:string,sandbox:RunnerSandbox){try{await access(cwd,constants.R_OK|constants.X_OK);if(sandbox==="workspace-write"){const probe=join(cwd,`.adt-runner-probe-${randomBytes(12).toString("hex")}`);try{const handle=await open(probe,"wx",0o600);await handle.close()}finally{await rm(probe,{force:true})}}return true}catch{return false}}
export function publicEnvironment(value:RunnerEnvironment):PublicRunnerEnvironment{return{key:value.key,name:value.name,enabled:value.enabled,ready:value.ready,sandbox:value.sandbox}}
function git(cwd:string,args:string[]):Promise<{ok:boolean;stdout:string}>{return new Promise(resolve=>execFile("git",args,{cwd,timeout:2_000,maxBuffer:8_192,encoding:"utf8"},(error,stdout)=>resolve({ok:!error,stdout:stdout.slice(0,4096)})))}
/** Read-only bounded diagnostics; paths, stderr, branches, remotes, and filenames never escape. */
export async function diagnoseWorkspace(environment:RunnerEnvironment):Promise<WorkspaceDiagnostics>{const base={environmentKey:environment.key,filesystemReady:environment.ready,gitAvailable:false,gitRepository:false,headCommit:null,dirty:null};const version=await git(environment.cwd,["--version"]);if(!version.ok)return base;const repository=await git(environment.cwd,["rev-parse","--is-inside-work-tree"]);if(!repository.ok||repository.stdout.trim()!=="true")return{...base,gitAvailable:true};const head=await git(environment.cwd,["rev-parse","--verify","HEAD"]),status=await git(environment.cwd,["status","--porcelain=v1","-uno"]);return{...base,gitAvailable:true,gitRepository:true,headCommit:head.ok&&/^[a-f0-9]{40}$/.test(head.stdout.trim())?head.stdout.trim():null,dirty:status.ok?status.stdout.length>0:null}}
export async function ensureStateDirectory(path:string){await mkdir(path,{recursive:true,mode:0o700});await access(path,constants.R_OK|constants.W_OK|constants.X_OK)}
