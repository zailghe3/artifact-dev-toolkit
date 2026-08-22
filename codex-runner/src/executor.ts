import {createServer,type IncomingMessage,type ServerResponse} from "node:http";
import {randomUUID,timingSafeEqual} from "node:crypto";
import {realpath} from "node:fs/promises";
import {relative,resolve} from "node:path";
import type {AppServerClient,WorkflowTurnResult} from "./app-server-client.js";
import {SafeError,safeError} from "./errors.js";
import {diagnoseWorkspace} from "./environments.js";
import type {RunnerConfiguration} from "./configuration.js";

const MAX_BODY=1_100_000,ID=/^[a-f0-9-]{36}$/,json=(r:ServerResponse,s:number,v:unknown)=>{r.writeHead(s,{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"});r.end(JSON.stringify(v))};
function authorized(req:IncomingMessage,secret:string){const value=req.headers["x-codex-executor-secret"];if(typeof value!=="string")return false;const a=Buffer.from(value),b=Buffer.from(secret);return a.length===b.length&&timingSafeEqual(a,b)}
async function body(req:IncomingMessage){let n=0;const chunks:Buffer[]=[];for await(const chunk of req){const b=Buffer.from(chunk);n+=b.length;if(n>MAX_BODY)throw new SafeError("request_too_large",413);chunks.push(b)}if(n&&!req.headers["content-type"]?.startsWith("application/json"))throw new SafeError("json_content_type_required",415);try{return n?JSON.parse(Buffer.concat(chunks).toString("utf8")):undefined}catch{throw new SafeError("invalid_request",400)}}
function object(value:unknown,allowed:string[]){if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new SafeError("invalid_request",400);return value as Record<string,unknown>}
async function safeCwd(candidate:string,root:string){const canonicalRoot=await realpath(root),canonical=await realpath(candidate),rel=relative(canonicalRoot,canonical);if(rel===""||(!rel.startsWith("..")&&!resolve(rel).startsWith("/")))return canonical;throw new SafeError("workspace_outside_root",400)}
type Execution={state:"running"|"completed"|"failed"|"cancelled";result?:WorkflowTurnResult;threadId?:string;turnId?:string;startedAt:string;updatedAt:string;activityCount:number};
export function createExecutorServer(configuration:RunnerConfiguration,app:AppServerClient){
 const generation=randomUUID(),executions=new Map<string,Execution>();let active:string|undefined;
 return createServer({requestTimeout:65_000,headersTimeout:10_000},async(req,res)=>{const path=new URL(req.url??"/","http://executor.invalid").pathname;try{
  if(req.method==="GET"&&path==="/health")return json(res,200,{ok:true,role:"executor",generation});if(!authorized(req,configuration.executorSecret!))throw new SafeError("unauthorized",401);const value=await body(req);
  if(req.method==="GET"&&path==="/internal/v1/status")return json(res,200,{generation,healthy:await app.readiness(),activeExecutionId:active??null,boundary:"container",release:{runnerVersion:configuration.runnerVersion}});
  if(req.method==="GET"&&path==="/internal/v1/account")return json(res,200,await app.status());
  if(req.method==="POST"&&path==="/internal/v1/auth/device/start"){if(value!==undefined)throw new SafeError("invalid_request",400);return json(res,200,await app.startDeviceLogin())}
  if(req.method==="POST"&&path==="/internal/v1/auth/logout"){if(value!==undefined)throw new SafeError("invalid_request",400);return json(res,200,await app.logout())}
  if(req.method==="GET"&&path==="/internal/v1/models")return json(res,200,{models:await app.listModels?.()??[]});
  if(req.method==="POST"&&path==="/internal/v1/test"){if(value!==undefined)throw new SafeError("invalid_request",400);return json(res,200,await app.testCodex?.("danger-full-access")??{ok:false,reason:"app_server_unavailable"})}
  if(req.method==="POST"&&path==="/internal/v1/workspace/diagnostics"){const v=object(value,["cwd"]);if(typeof v.cwd!=="string"||v.cwd.length>4096)throw new SafeError("invalid_request",400);const cwd=await safeCwd(v.cwd,configuration.workspaceRoot??"/workspaces");return json(res,200,await diagnoseWorkspace({key:"executor",name:"Executor workspace",cwd,enabled:true,ready:true,sandbox:"workspace-write"}))}
  if(req.method==="POST"&&path==="/internal/v1/executions"){if(active)throw new SafeError("runner_busy",409);const v=object(value,["cwd","sandbox","prompt","model","reasoningEffort"]);if(typeof v.cwd!=="string"||typeof v.prompt!=="string"||Buffer.byteLength(v.prompt)>524_320||v.sandbox!=="workspace-write"||(v.model!==undefined&&(typeof v.model!=="string"||v.model.length>120))||(v.reasoningEffort!==undefined&&(typeof v.reasoningEffort!=="string"||v.reasoningEffort.length>40)))throw new SafeError(v.sandbox==="read-only"?"read_only_not_supported": "invalid_request",v.sandbox==="read-only"?409:400);const cwd=await safeCwd(v.cwd,configuration.workspaceRoot??"/workspaces"),id=randomUUID(),now=new Date().toISOString(),record:Execution={state:"running",startedAt:now,updatedAt:now,activityCount:0};executions.set(id,record);active=id;void app.runWorkflowTurn!({cwd,sandbox:"danger-full-access",prompt:v.prompt as string,...(v.model?{model:v.model as string}:{}),...(v.reasoningEffort?{reasoningEffort:v.reasoningEffort as string}:{}),onStarted:(threadId,turnId)=>{record.threadId=threadId;record.turnId=turnId;record.activityCount++;record.updatedAt=new Date().toISOString()}}).then(result=>{record.result=result;record.state=result.ok?"completed":record.state==="cancelled"?"cancelled":"failed";record.updatedAt=new Date().toISOString()}).catch(()=>{record.result={ok:false,reason:"turn_failed"};record.state="failed";record.updatedAt=new Date().toISOString()}).finally(()=>{if(active===id)active=undefined});return json(res,202,{executionId:id,generation})}
  const match=/^\/internal\/v1\/executions\/([a-f0-9-]{36})(\/cancel)?$/.exec(path);if(match&&!ID.test(match[1]!))throw new SafeError("not_found",404);if(match&&req.method==="GET"&&!match[2]){const execution=executions.get(match[1]!);if(!execution)throw new SafeError("not_found",404);return json(res,200,{executionId:match[1],generation,...execution})}if(match&&req.method==="POST"&&match[2]){if(value!==undefined)throw new SafeError("invalid_request",400);const execution=executions.get(match[1]!);if(!execution)throw new SafeError("not_found",404);if(execution.state==="running"&&execution.threadId&&execution.turnId){execution.state="cancelled";await app.interruptWorkflowTurn?.(execution.threadId,execution.turnId)}return json(res,200,{executionId:match[1],generation,state:execution.state})}
  throw new SafeError("not_found",404);
 }catch(error){const safe=safeError(error);json(res,safe.status,{error:safe.code})}}).on("close",()=>void app.close());
}

/* The private transport validates each value at its public boundary; `any` keeps this adapter compact. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export class RemoteExecutorClient implements AppServerClient{
 constructor(private readonly base:string,private readonly secret:string,private generation?:string){}
 private async request(path:string,method="GET",payload?:unknown):Promise<any>{const response=await fetch(new URL(path,this.base),{method,headers:{"x-codex-executor-secret":this.secret,...(payload===undefined?{}:{"content-type":"application/json"})},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(30_000)});const value:any=await response.json();if(!response.ok)throw new Error(typeof value?.error==="string"?value.error:"executor_unavailable");return value}
 async readiness(){try{const s=await this.request("/internal/v1/status");this.generation=s.generation;return s.healthy===true}catch{return false}}
 status(){return this.request("/internal/v1/account")}
 startDeviceLogin(){return this.request("/internal/v1/auth/device/start","POST")}
 logout(){return this.request("/internal/v1/auth/logout","POST")}
 async listModels(){return (await this.request("/internal/v1/models")).models}
 testCodex(){return this.request("/internal/v1/test","POST")}
 workspaceDiagnostics(cwd:string){return this.request("/internal/v1/workspace/diagnostics","POST",{cwd})}
 executorStatus(){return this.request("/internal/v1/status")}
 async runWorkflowTurn(input:Parameters<NonNullable<AppServerClient["runWorkflowTurn"]>>[0]){const started=await this.request("/internal/v1/executions","POST",input),generation=started.generation;this.generation=generation;input.onStarted?.(generation,started.executionId);for(;;){await new Promise(r=>setTimeout(r,250));const current=await this.request(`/internal/v1/executions/${started.executionId}`);if(current.generation!==generation)return{ok:false,reason:"turn_failed"} as WorkflowTurnResult;if(current.state!=="running")return current.result??{ok:false,reason:"turn_failed"} as WorkflowTurnResult}}
 async interruptWorkflowTurn(_generation:string,executionId:string){try{await this.request(`/internal/v1/executions/${executionId}/cancel`,"POST")}catch{}}
 async close(){}
}
