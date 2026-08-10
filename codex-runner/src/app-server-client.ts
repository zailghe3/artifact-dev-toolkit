import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {createInterface} from "node:readline";

export interface AccountSnapshot {connected:boolean;authMode?:string;planType?:string}
export interface DeviceCeremony {loginId:string;verificationUrl:string;userCode:string}
export interface AppServerClient {status():Promise<unknown>;startDeviceLogin():Promise<unknown>;logout():Promise<unknown>;close():Promise<void>}

export class StdioAppServerClient implements AppServerClient{
  private process?:ChildProcessWithoutNullStreams; private id=0; private pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void}>();
  constructor(private readonly command="codex"){}
  private ensure(){if(this.process)return;const child=spawn(this.command,["app-server"],{stdio:["pipe","pipe","pipe"],env:process.env});this.process=child;createInterface({input:child.stdout}).on("line",line=>{try{const value=JSON.parse(line) as {id?:number;result?:unknown;error?:unknown};if(typeof value.id!=="number")return;const pending=this.pending.get(value.id);if(!pending)return;this.pending.delete(value.id);value.error?pending.reject(new Error("app_server_request_failed")):pending.resolve(value.result);}catch{/* Never log raw App Server output. */}});child.on("exit",()=>{for(const item of this.pending.values())item.reject(new Error("app_server_unavailable"));this.pending.clear();this.process=undefined;});child.stderr.resume();}
  private request(method:string,params:unknown={}):Promise<unknown>{this.ensure();const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.process!.stdin.write(`${JSON.stringify({jsonrpc:"2.0",id,method,params})}\n`);});}
  status(){return this.request("account/read");}
  startDeviceLogin(){return this.request("account/login/start",{type:"chatgpt",authType:"deviceCode"});}
  logout(){return this.request("account/logout");}
  async close(){this.process?.kill("SIGTERM");this.process=undefined;}
}
