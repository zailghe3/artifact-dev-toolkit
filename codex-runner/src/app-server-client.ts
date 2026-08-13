import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {STATUS_CODES} from "node:http";
import {createInterface,type Interface} from "node:readline";

export interface AccountSnapshot {connected:boolean;authMode?:string;planType?:string;runtime:"app-server-ready"}
export interface DeviceCeremony {loginId:string;verificationUrl:string;userCode:string}
export interface AppServerClient {readiness():Promise<boolean>;status():Promise<unknown>;startDeviceLogin():Promise<unknown>;logout():Promise<unknown>;close():Promise<void>}
type Pending={resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout};
type Spawn=typeof spawn;

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
  constructor(private readonly command="codex",private readonly runnerVersion="development",private readonly timeoutMs=8_000,private readonly spawnProcess:Spawn=spawn,private readonly respectSystemProxy=false){}

  async readiness(){try{await this.ready();return true}catch{return false}}
  status(){return this.afterReady("account/read",{refreshToken:false})}
  startDeviceLogin(){return this.afterReady("account/login/start",{type:"chatgptDeviceCode"})}
  logout(){return this.afterReady("account/logout")}

  private async afterReady(method:string,params?:unknown){await this.ready();return this.request(method,params)}
  private ready(){if(this.initialization)return this.initialization;this.start();this.initialization=this.initialize();return this.initialization}
  private start(){
    let child:ChildProcessWithoutNullStreams;
    try{child=this.spawnProcess(this.command,this.respectSystemProxy?["--enable","respect_system_proxy","app-server"]:["app-server"],{stdio:["pipe","pipe","pipe"],env:process.env})}catch{throw new Error("app_server_unavailable")}
    this.process=child;
    this.lines=createInterface({input:child.stdout});
    this.lines.on("line",line=>this.receive(line));
    child.stderr.resume();
    child.once("error",()=>this.failProcess());
    child.once("exit",()=>this.failProcess());
    child.stdin.once("error",()=>this.failProcess());
  }
  private async initialize(){try{await this.request("initialize",{clientInfo:{name:"adt_codex_runner",title:"ADT Codex Runner",version:this.runnerVersion}});this.notify("initialized");}catch{this.failProcess();throw new Error("app_server_initialization_failed")}}
  private receive(line:string){try{const message=JSON.parse(line) as {id?:number;result?:unknown;error?:unknown};if(typeof message.id!=="number")return;const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);clearTimeout(pending.timer);if(message.error===undefined)pending.resolve(message.result);else pending.reject(appServerError(message.error));}catch{/* Raw protocol messages are intentionally discarded. */}}
  private request(method:string,params?:unknown):Promise<unknown>{const id=++this.id,message=params===undefined?{method,id}:{method,id,params};return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error("app_server_request_timeout"));},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});this.write(message).catch(()=>{const pending=this.pending.get(id);if(!pending)return;this.pending.delete(id);clearTimeout(pending.timer);pending.reject(new Error("app_server_unavailable"));this.failProcess();});})}
  private notify(method:string){void this.write({method}).catch(()=>this.failProcess())}
  private write(message:unknown){return new Promise<void>((resolve,reject)=>{const process=this.process;if(!process||process.stdin.destroyed)return reject(new Error("app_server_unavailable"));process.stdin.write(`${JSON.stringify(message)}\n`,error=>error?reject(new Error("app_server_unavailable")):resolve());})}
  private failProcess(){const process=this.process;this.process=undefined;this.initialization=undefined;this.lines?.close();this.lines=undefined;for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error("app_server_unavailable"));}this.pending.clear();if(process&&!process.killed)process.kill("SIGTERM")}
  async close(){this.failProcess()}
}
