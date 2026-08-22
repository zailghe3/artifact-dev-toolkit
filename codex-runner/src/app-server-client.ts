import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {STATUS_CODES} from "node:http";
import {createInterface,type Interface} from "node:readline";
import {randomBytes} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

export interface AccountSnapshot {connected:boolean;authMode?:string;planType?:string;runtime:"app-server-ready"}
export interface DeviceCeremony {loginId:string;verificationUrl:string;userCode:string}
export type CodexTestFailureReason="codex_not_connected"|"app_server_unavailable"|"thread_start_failed"|"turn_start_failed"|"turn_failed"|"timeout"|"unexpected_output"|"unexpected_tool_activity"|"test_in_progress";
export type CodexTestResult={ok:true;durationMs:number}|{ok:false;reason:CodexTestFailureReason};
export interface SafeCodexModel{id:string;threadModel:string;displayName:string;isDefault:boolean;defaultReasoningEffort:string;supportedReasoningEfforts:{reasoningEffort:string;description:string}[]}
export type WorkflowTurnResult={ok:true;outputText:string;threadId:string;turnId:string}|{ok:false;reason:"runner_restarted"|"thread_start_failed"|"turn_start_failed"|"turn_failed"|"interaction_required"|"output_too_large";threadId?:string;turnId?:string};
export const EXECUTOR_CODEX_CONFIG_OVERRIDES=["allow_login_shell=false",'web_search="disabled"','shell_environment_policy.inherit="none"','shell_environment_policy.exclude=["*KEY*","*SECRET*","*TOKEN*","*PASSWORD*","*CREDENTIAL*","*AUTH*"]'] as const;
export interface AppServerClient {readiness():Promise<boolean>;status():Promise<unknown>;startDeviceLogin():Promise<unknown>;logout():Promise<unknown>;testCodex?(sandbox?:"read-only"|"danger-full-access"):Promise<CodexTestResult>;listModels?():Promise<SafeCodexModel[]>;runWorkflowTurn?(input:{cwd:string;sandbox:"read-only"|"workspace-write"|"danger-full-access";prompt:string;model?:string;reasoningEffort?:string;onStarted?:(threadId:string,turnId:string)=>void}):Promise<WorkflowTurnResult>;observeWorkflowTurn?(generation:string,executionId:string):Promise<WorkflowTurnResult>;reconcileUnknownExecution?():Promise<WorkflowTurnResult>;interruptWorkflowTurn?(threadId:string,turnId:string):Promise<void>;close():Promise<void>}
type Pending={resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout};
type Spawn=typeof spawn;
class HealthDeadlineError extends Error{constructor(){super("health_deadline")}}
class RequestTimeoutError extends Error{constructor(){super("app_server_request_timeout")}}

export type DeviceAuthFailureReason="chatgpt_login_disabled"|"device_auth_not_enabled"|"device_auth_upstream_forbidden"|"device_auth_rate_limited"|"device_auth_upstream_unavailable"|"device_auth_upstream_rejected"|"device_auth_transport_error"|"device_auth_ca_configuration"|"device_auth_http_client_configuration"|"device_auth_internal"|"device_auth_unknown";
export class AppServerRequestError extends Error{
  constructor(public readonly reason:DeviceAuthFailureReason,public readonly jsonRpcCode:number,public readonly upstreamHttpStatus?:number){super("app_server_request_failed")}
}
function appServerError(value:unknown):Error{
  if(!value||typeof value!=="object"||Array.isArray(value))return new Error("app_server_request_failed");
  const {code,message}=value as {code?:unknown;message?:unknown};
  if(typeof code!=="number"||!Number.isFinite(code)||!Number.isInteger(code)||typeof message!=="string")return new Error("app_server_request_failed");
  if(message==="ChatGPT login is disabled. Use API key login instead.")return new AppServerRequestError("chatgpt_login_disabled",code);
  if(message==="device code login is not enabled for this Codex server. Use the browser login or verify the server URL.")return new AppServerRequestError("device_auth_not_enabled",code);
  const statusMatch=/^failed to request device code: device code request failed with status ([1-5]\d\d)(?: (.+))?$/.exec(message);
  if(statusMatch){const status=Number(statusMatch[1]);const reasonPhrase=statusMatch[2];if(reasonPhrase===undefined||reasonPhrase===STATUS_CODES[status]){const reason=status===403?"device_auth_upstream_forbidden":status===429?"device_auth_rate_limited":status>=500?"device_auth_upstream_unavailable":"device_auth_upstream_rejected";return new AppServerRequestError(reason,code,status)}}
  if(message==="failed to request device code: error sending request for url (https://auth.openai.com/api/accounts/deviceauth/usercode)")return new AppServerRequestError("device_auth_transport_error",code);
  const caPrefix="failed to request device code: ",caEnvironment="(?:CODEX_CA_CERTIFICATE|SSL_CERT_FILE)",caPath=".+";
  const caConfiguration=new RegExp(`^${caPrefix}(?:Failed to read CA certificate file ${caPath} selected by ${caEnvironment}: .+|Failed to load CA certificates from ${caPath} selected by ${caEnvironment}: .+|Failed to parse certificate #\\d+ from ${caPath} selected by ${caEnvironment}: .+|Failed to register certificate #\\d+ from ${caPath} selected by ${caEnvironment} in rustls root store: .+)$`);
  if(caConfiguration.test(message))return new AppServerRequestError("device_auth_ca_configuration",code);
  const clientConfiguration=new RegExp(`^${caPrefix}(?:Failed to build HTTP client while using CA bundle from ${caPath} selected by ${caEnvironment}: .+|Failed to build HTTP client while using system root certificates: .+)$`);
  if(clientConfiguration.test(message))return new AppServerRequestError("device_auth_http_client_configuration",code);
  return new AppServerRequestError(code===-32603?"device_auth_internal":"device_auth_unknown",code);
}

export class StdioAppServerClient implements AppServerClient{
  private process?:ChildProcessWithoutNullStreams;
  private lines?:Interface;
  private initialization?:Promise<void>;
  private id=0;
  private pending=new Map<number,Pending>();
  private turnLifecycle?:{threadId:string;turnId?:string;agentText?:string;tool:boolean;resolve:(result:"completed"|"failed"|"tool")=>void};
  private testRunning=false;
  private workflowLifecycle?:{threadId:string;turnId?:string;agentText?:string;resolve:(result:"completed"|"failed"|"interaction")=>void};
  constructor(private readonly command="codex",private readonly runnerVersion="development",private readonly timeoutMs=8_000,private readonly spawnProcess:Spawn=spawn,private readonly healthTimeoutMs=52_000,private readonly cleanupReserveMs=2_000,private readonly configOverrides:string[]=[]){ }

  async readiness(){try{await this.ready();return true}catch{return false}}
  status(){return this.afterReady("account/read",{refreshToken:false})}
  startDeviceLogin(){return this.afterReady("account/login/start",{type:"chatgptDeviceCode"})}
  logout(){return this.afterReady("account/logout")}
  async testCodex(sandbox:"read-only"|"danger-full-access"="read-only"):Promise<CodexTestResult>{
    if(this.testRunning)return{ok:false,reason:"test_in_progress"};
    this.testRunning=true;
    const started=Date.now(),deadline=started+this.healthTimeoutMs,operationDeadline=deadline-Math.min(this.cleanupReserveMs,Math.floor(this.healthTimeoutMs/4));let cwd:string|undefined,threadId:string|undefined,turnId:string|undefined;
    try{
      let status:unknown;try{status=await this.healthRequest("account/read",{refreshToken:false},operationDeadline)}catch(error){return{ok:false,reason:error instanceof HealthDeadlineError?"timeout":"app_server_unavailable"}}
      if(!status||typeof status!=="object"||!(status as {account?:unknown}).account)return{ok:false,reason:"codex_not_connected"};
      cwd=await this.within(mkdtemp(join(tmpdir(),"adt-codex-test-")),operationDeadline);
      const nonce=`ADT_CODEX_TEST_${randomBytes(18).toString("hex")}`;
      let thread:unknown;try{thread=await this.healthRequest("thread/start",{cwd,approvalPolicy:"never",sandbox,ephemeral:true},operationDeadline)}catch(error){return{ok:false,reason:error instanceof HealthDeadlineError?"timeout":"thread_start_failed"}}
      threadId=this.identifier(thread,"thread");if(!threadId)return{ok:false,reason:"thread_start_failed"};const activeThreadId=threadId;
      const completion=new Promise<"completed"|"failed"|"tool">(resolve=>{this.turnLifecycle={threadId:activeThreadId,tool:false,resolve}});
      const prompt=`Return exactly the following text and nothing else:\n${nonce}\nDo not use tools, shell commands, filesystem access, network tools, or make changes.`;
      let turn:unknown;try{turn=await this.healthRequest("turn/start",{threadId,input:[{type:"text",text:prompt}]},operationDeadline)}catch(error){return{ok:false,reason:error instanceof HealthDeadlineError?"timeout":"turn_start_failed"}}
      turnId=this.identifier(turn,"turn");if(!turnId)return{ok:false,reason:"turn_start_failed"};this.turnLifecycle!.turnId=turnId;
      let outcome:"completed"|"failed"|"tool";try{outcome=await this.within(completion,operationDeadline)}catch{await this.interrupt(threadId,turnId,deadline);return{ok:false,reason:"timeout"}}
      if(outcome==="tool"){await this.interrupt(threadId,turnId,deadline);return{ok:false,reason:"unexpected_tool_activity"}}
      if(outcome==="failed")return{ok:false,reason:"turn_failed"};
      if(this.turnLifecycle?.agentText!==nonce)return{ok:false,reason:"unexpected_output"};
      const durationMs=Date.now()-started;if(durationMs>=operationDeadline-started)return{ok:false,reason:"timeout"};return{ok:true,durationMs};
    }catch(error){return{ok:false,reason:error instanceof HealthDeadlineError?"timeout":"app_server_unavailable"}}
    finally{this.turnLifecycle=undefined;if(cwd)try{await this.within(rm(cwd,{recursive:true,force:true}),deadline)}catch{/* Cleanup consumed its reserved budget. */}this.testRunning=false}
  }
  async listModels():Promise<SafeCodexModel[]>{
    const output:SafeCodexModel[]=[];let cursor:string|undefined;
    for(let page=0;page<10&&output.length<25;page++){const value=await this.afterReady("model/list",{includeHidden:false,limit:25,...(cursor?{cursor}:{})}) as Record<string,unknown>,data=value.data;if(!Array.isArray(data))throw new Error("invalid_model_catalog");for(const raw of data){if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("invalid_model_catalog");const model=raw as Record<string,unknown>,efforts=model.supportedReasoningEfforts;if(typeof model.id!=="string"||!model.id||model.id.length>120||typeof model.model!=="string"||!model.model||model.model.length>120||typeof model.displayName!=="string"||!model.displayName||model.displayName.length>120||typeof model.isDefault!=="boolean"||typeof model.defaultReasoningEffort!=="string"||model.defaultReasoningEffort.length>40||!Array.isArray(efforts)||efforts.length>12)throw new Error("invalid_model_catalog");const safeEfforts=efforts.map(item=>{if(!item||typeof item!=="object"||Array.isArray(item)||typeof (item as Record<string,unknown>).reasoningEffort!=="string"||typeof (item as Record<string,unknown>).description!=="string")throw new Error("invalid_model_catalog");return{reasoningEffort:String((item as Record<string,unknown>).reasoningEffort).slice(0,40),description:String((item as Record<string,unknown>).description).slice(0,240)}});output.push({id:model.id,threadModel:model.model,displayName:model.displayName,isDefault:model.isDefault,defaultReasoningEffort:model.defaultReasoningEffort,supportedReasoningEfforts:safeEfforts});if(output.length>=25)break}cursor=typeof value.nextCursor==="string"&&value.nextCursor.length<=200?value.nextCursor:undefined;if(!cursor)break}return output;
  }
  async runWorkflowTurn(input:{cwd:string;sandbox:"read-only"|"workspace-write"|"danger-full-access";prompt:string;model?:string;reasoningEffort?:string;onStarted?:(threadId:string,turnId:string)=>void}):Promise<WorkflowTurnResult>{
    if(this.workflowLifecycle)throw new Error("runner_busy");let threadId:string|undefined,turnId:string|undefined;
    try{let thread:unknown;try{thread=await this.afterReady("thread/start",{cwd:input.cwd,approvalPolicy:"never",sandbox:input.sandbox,...(input.model?{model:input.model}:{})})}catch{return{ok:false,reason:"thread_start_failed"}}threadId=this.identifier(thread,"thread");if(!threadId)return{ok:false,reason:"thread_start_failed"};const active=threadId,completion=new Promise<"completed"|"failed"|"interaction">(resolve=>{this.workflowLifecycle={threadId:active,resolve}});let turn:unknown;try{turn=await this.afterReady("turn/start",{threadId,input:[{type:"text",text:input.prompt}],...(input.reasoningEffort?{effort:input.reasoningEffort}:{})})}catch{return{ok:false,reason:"turn_start_failed",threadId}}turnId=this.identifier(turn,"turn");if(!turnId)return{ok:false,reason:"turn_start_failed",threadId};this.workflowLifecycle!.turnId=turnId;input.onStarted?.(threadId,turnId);const outcome=await completion;if(outcome==="interaction"){await this.interruptWorkflowTurn(threadId,turnId);return{ok:false,reason:"interaction_required",threadId,turnId}}if(outcome==="failed")return{ok:false,reason:"turn_failed",threadId,turnId};const text=(this.workflowLifecycle as {agentText?:string}|undefined)?.agentText;if(typeof text!=="string")return{ok:false,reason:"turn_failed",threadId,turnId};if(Buffer.byteLength(text)>262_144)return{ok:false,reason:"output_too_large",threadId,turnId};return{ok:true,outputText:text,threadId,turnId}}finally{this.workflowLifecycle=undefined}
  }
  async interruptWorkflowTurn(threadId:string,turnId:string){try{await this.afterReady("turn/interrupt",{threadId,turnId})}catch{/* best effort */}}
  private identifier(value:unknown,key:"thread"|"turn"){const wrapped=value&&typeof value==="object"?(value as Record<string,unknown>)[key]:undefined;return wrapped&&typeof wrapped==="object"&&typeof (wrapped as {id?:unknown}).id==="string"?(wrapped as {id:string}).id:undefined}
  private remaining(deadline:number){return Math.max(0,deadline-Date.now())}
  private within<T>(operation:Promise<T>,deadline:number){const remaining=this.remaining(deadline);if(remaining<=0)return Promise.reject(new HealthDeadlineError());return new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>reject(new HealthDeadlineError()),remaining);operation.then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})})}
  private async healthRequest(method:string,params:unknown,deadline:number){await this.within(this.ready(),deadline);const remaining=this.remaining(deadline);if(remaining<=0)throw new HealthDeadlineError();const deadlineConstrained=remaining<=this.timeoutMs,rpcTimeout=Math.min(this.timeoutMs,remaining);try{return await this.within(this.request(method,params,rpcTimeout),deadline)}catch(error){if(error instanceof HealthDeadlineError||(deadlineConstrained&&error instanceof RequestTimeoutError))throw new HealthDeadlineError();throw error}}
  private async interrupt(threadId:string,turnId:string,deadline:number){const remaining=this.remaining(deadline),interruptDeadline=Date.now()+Math.min(1_000,Math.max(1,Math.floor(remaining/2)));try{await this.healthRequest("turn/interrupt",{threadId,turnId},interruptDeadline)}catch{/* Interruption is best effort and leaves budget for filesystem cleanup. */}}

  private async afterReady(method:string,params?:unknown){await this.ready();return this.request(method,params)}
  private ready(){if(this.initialization)return this.initialization;this.start();this.initialization=this.initialize();return this.initialization}
  private start(){
    let child:ChildProcessWithoutNullStreams;
    const args=this.configOverrides.flatMap(value=>["-c",value]);
    try{child=this.spawnProcess(this.command,[...args,"app-server"],{stdio:["pipe","pipe","pipe"],env:process.env})}catch{throw new Error("app_server_unavailable")}
    this.process=child;
    this.lines=createInterface({input:child.stdout});
    this.lines.on("line",line=>this.receive(line));
    child.stderr.resume();
    child.once("error",()=>this.failProcess());
    child.once("exit",()=>this.failProcess());
    child.stdin.once("error",()=>this.failProcess());
  }
  private async initialize(){try{await this.request("initialize",{clientInfo:{name:"adt_codex_runner",title:"ADT Codex Runner",version:this.runnerVersion}});this.notify("initialized");}catch{this.failProcess();throw new Error("app_server_initialization_failed")}}
  private receive(line:string){try{const message=JSON.parse(line) as {id?:unknown;method?:unknown;params?:unknown;result?:unknown;error?:unknown};const hasId=Object.hasOwn(message,"id");if(typeof message.method==="string"){if(hasId)this.receiveServerRequest(message.params);else this.receiveTurnNotification(message.method,message.params);return}if(typeof message.id!=="number")return;const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);clearTimeout(pending.timer);if(message.error===undefined)pending.resolve(message.result);else pending.reject(appServerError(message.error))}catch{/* Raw protocol messages are intentionally discarded. */}}
  private receiveServerRequest(params:unknown){const workflow=this.workflowLifecycle;if(workflow&&params&&typeof params==="object"){const value=params as Record<string,unknown>;if(value.threadId===workflow.threadId&&(!workflow.turnId||value.turnId===undefined||value.turnId===workflow.turnId)){workflow.resolve("interaction");return}}const active=this.turnLifecycle;if(!active||!params||typeof params!=="object")return;const value=params as Record<string,unknown>;if(value.threadId!==active.threadId||(active.turnId&&value.turnId!==undefined&&value.turnId!==active.turnId))return;active.tool=true;active.resolve("tool")}
  private receiveTurnNotification(method:unknown,params:unknown){if(typeof method!=="string"||!params||typeof params!=="object")return;const value=params as Record<string,unknown>,workflow=this.workflowLifecycle;if(workflow&&value.threadId===workflow.threadId&&(!workflow.turnId||value.turnId===undefined||value.turnId===workflow.turnId)){const item=value.item&&typeof value.item==="object"?value.item as Record<string,unknown>:undefined;if(method==="item/completed"&&item?.type==="agentMessage"&&typeof item.text==="string")workflow.agentText=item.text;if(method==="turn/completed"){const turn=value.turn as Record<string,unknown>|undefined;workflow.resolve(turn?.status==="completed"?"completed":"failed")}return}const active=this.turnLifecycle;if(!active)return;if(value.threadId!==active.threadId||(active.turnId&&value.turnId!==undefined&&value.turnId!==active.turnId))return;const item=value.item&&typeof value.item==="object"?value.item as Record<string,unknown>:undefined,type=item?.type;if(method==="item/started"&&typeof type==="string"&&!["userMessage","agentMessage","reasoning"].includes(type)){active.tool=true;active.resolve("tool");return}if(method==="item/completed"&&type==="agentMessage"&&typeof item?.text==="string")active.agentText=item.text;if(method==="turn/completed"){const turn=value.turn as Record<string,unknown>|undefined;if(turn&&typeof turn.id==="string"&&!active.turnId)active.turnId=turn.id;active.resolve(turn?.status==="completed"?"completed":"failed")}}
  private request(method:string,params?:unknown,timeoutMs=this.timeoutMs):Promise<unknown>{const id=++this.id,message=params===undefined?{method,id}:{method,id,params};return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new RequestTimeoutError());},timeoutMs);this.pending.set(id,{resolve,reject,timer});this.write(message).catch(()=>{const pending=this.pending.get(id);if(!pending)return;this.pending.delete(id);clearTimeout(pending.timer);pending.reject(new Error("app_server_unavailable"));this.failProcess();});})}
  private notify(method:string){void this.write({method}).catch(()=>this.failProcess())}
  private write(message:unknown){return new Promise<void>((resolve,reject)=>{const process=this.process;if(!process||process.stdin.destroyed)return reject(new Error("app_server_unavailable"));process.stdin.write(`${JSON.stringify(message)}\n`,error=>error?reject(new Error("app_server_unavailable")):resolve());})}
  private failProcess(){const process=this.process;this.process=undefined;this.initialization=undefined;this.lines?.close();this.lines=undefined;for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error("app_server_unavailable"));}this.pending.clear();if(process&&!process.killed)process.kill("SIGTERM")}
  async close(){this.failProcess()}
}
