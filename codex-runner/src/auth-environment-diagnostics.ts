import {access,constants} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import {lookup} from "node:dns/promises";
import {connect,type Socket} from "node:net";

const AUTH_HOST="auth.openai.com",AUTH_PORT=443,PROBE_TIMEOUT_MS=2_000;
export type AuthEnvironmentDiagnostics={runnerReachable:true;codexAppServerReady:boolean;customCaSource:"none"|"codex_ca_certificate"|"ssl_cert_file";customCaFileReadable?:boolean;httpProxyConfigured:boolean;httpsProxyConfigured:boolean;allProxyConfigured:boolean;noProxyConfigured:boolean;dnsResolution:"ok"|"failed";ipv4Available:boolean;ipv6Available:boolean;tcpConnectivity:"ok"|"timeout"|"failed";codexHomeReadable:boolean;codexHomeWritable:boolean};
type LookupAddress={address:string;family:number};
type Dependencies={environment?:NodeJS.ProcessEnv;lookupHost?:(hostname:string)=>Promise<LookupAddress[]>;connectHost?:(host:string,port:number,timeoutMs:number)=>Promise<"ok"|"timeout"|"failed">;accessPath?:(path:string,mode:number)=>Promise<void>;codexAppServerReady?:()=>Promise<boolean>};
const present=(environment:NodeJS.ProcessEnv,upper:string,lower:string)=>Boolean(environment[upper]||environment[lower]);
const bounded=<T>(operation:Promise<T>,timeoutMs:number,fallback:T)=>new Promise<T>(resolve=>{const timer=setTimeout(()=>resolve(fallback),timeoutMs);operation.then(value=>{clearTimeout(timer);resolve(value)},()=>{clearTimeout(timer);resolve(fallback)})});
const boundedAccess=(operation:Promise<void>,timeoutMs:number)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(reject,timeoutMs);operation.then(()=>{clearTimeout(timer);resolve()},()=>{clearTimeout(timer);reject()})});
async function defaultConnect(host:string,port:number,timeoutMs:number){return new Promise<"ok"|"timeout"|"failed">(resolve=>{let done=false;const socket:Socket=connect({host,port});const finish=(result:"ok"|"timeout"|"failed")=>{if(done)return;done=true;socket.destroy();resolve(result)};socket.setTimeout(timeoutMs,()=>finish("timeout"));socket.once("connect",()=>finish("ok"));socket.once("error",()=>finish("failed"))})}
export async function diagnoseAuthEnvironment(dependencies:Dependencies={}):Promise<AuthEnvironmentDiagnostics>{
 const environment=dependencies.environment??process.env,caPath=environment.CODEX_CA_CERTIFICATE||environment.SSL_CERT_FILE,customCaSource=environment.CODEX_CA_CERTIFICATE?"codex_ca_certificate":environment.SSL_CERT_FILE?"ssl_cert_file":"none",accessPath=dependencies.accessPath??access,home=environment.CODEX_HOME??join(homedir(),".codex");
 const canAccess=async(mode:number)=>{try{await boundedAccess(accessPath(home,mode),PROBE_TIMEOUT_MS);return true}catch{return false}};
 const caReadable=async()=>{if(!caPath)return undefined;try{await boundedAccess(accessPath(caPath,constants.R_OK),PROBE_TIMEOUT_MS);return true}catch{return false}};
 const [addresses,codexAppServerReady,tcpConnectivity,codexHomeReadable,codexHomeWritable,customCaFileReadable]=await Promise.all([bounded((dependencies.lookupHost??(hostname=>lookup(hostname,{all:true})))(AUTH_HOST),PROBE_TIMEOUT_MS,[]),bounded(dependencies.codexAppServerReady?.()??Promise.resolve(false),PROBE_TIMEOUT_MS,false),bounded((dependencies.connectHost??defaultConnect)(AUTH_HOST,AUTH_PORT,PROBE_TIMEOUT_MS),PROBE_TIMEOUT_MS+100,"timeout"),canAccess(constants.R_OK),canAccess(constants.W_OK),caReadable()]);
 const result:AuthEnvironmentDiagnostics={runnerReachable:true,codexAppServerReady,customCaSource,httpProxyConfigured:present(environment,"HTTP_PROXY","http_proxy"),httpsProxyConfigured:present(environment,"HTTPS_PROXY","https_proxy"),allProxyConfigured:present(environment,"ALL_PROXY","all_proxy"),noProxyConfigured:present(environment,"NO_PROXY","no_proxy"),dnsResolution:addresses.length?"ok":"failed",ipv4Available:addresses.some(value=>value.family===4),ipv6Available:addresses.some(value=>value.family===6),tcpConnectivity,codexHomeReadable,codexHomeWritable};
 if(customCaFileReadable!==undefined)result.customCaFileReadable=customCaFileReadable;
 return result;
}
