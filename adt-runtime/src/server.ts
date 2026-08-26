import {createServer,type IncomingMessage,type ServerResponse} from "node:http";
import {importPrivateKey,secretValue,authenticate,ReplayCache,MAX_BODY_BYTES,PROTOCOL_VERSION,READINESS_PATH,EXECUTE_PATH,executionSchema,decryptCredential} from "./protocol.js";
import {executeOpenAIAgents,RuntimeFailure,type Factories} from "./openai-agents.js";

type Options={host:string;port:number;authSecret:string;privateKeyPem:string;keyId:string;revision:string;factories?:Partial<Factories>;now?:()=>number};
const safe=(res:ServerResponse,status:number,value:unknown)=>{const body=JSON.stringify(value);res.writeHead(status,{"content-type":"application/json","content-length":Buffer.byteLength(body),"cache-control":"no-store"});res.end(body)};
const error=(res:ServerResponse,status:number,code:string,message:string,category?:string)=>safe(res,status,{protocolVersion:PROTOCOL_VERSION,ok:false,error:{code,...(category?{category}:{}),safeMessage:message,retryable:false}});
async function body(req:IncomingMessage){const chunks:Buffer[]=[];let size=0;for await(const value of req){size+=value.length;if(size>MAX_BODY_BYTES)throw new Error("body_too_large");chunks.push(value)}return Buffer.concat(chunks)}
export async function createRuntimeServer(options:Options){
 const privateKey=await importPrivateKey(options.privateKeyPem),replays=new ReplayCache();let shuttingDown=false;
 const server=createServer(async(req,res)=>{
  res.setHeader("x-content-type-options","nosniff");const path=new URL(req.url??"/","http://runtime.invalid").pathname;
  if(req.method==="GET"&&path==="/healthz")return safe(res,shuttingDown?503:200,{ok:!shuttingDown});
  if(shuttingDown)return error(res,503,"runtime_unavailable","Runtime is shutting down.");
  let raw:Buffer;try{raw=await body(req)}catch{return error(res,413,"request_too_large","Request body exceeds the permitted size.")}
  if(!authenticate(req.headers,req.method??"",path,raw,options.authSecret,replays,options.now?.()))return error(res,401,"authentication_failed","Runtime request authentication failed.");
  if(req.method==="GET"&&path===READINESS_PATH)return safe(res,200,{protocolVersion:PROTOCOL_VERSION,runtimeRevision:options.revision,capabilities:["openai-agents"],credentialWrappingKeyId:options.keyId});
  if(req.method!=="POST"||path!==EXECUTE_PATH)return error(res,404,"unsupported_operation","Runtime operation is unsupported.");
  let request;try{request=executionSchema.parse(JSON.parse(raw.toString("utf8")))}catch{return error(res,400,"invalid_request","Runtime request is invalid.")}
  const aad=`${PROTOCOL_VERSION}:${request.capability}:${request.idempotencyKey}`;let credential:string;try{credential=await decryptCredential(request.credential,privateKey,options.keyId,aad)}catch{return error(res,400,"credential_invalid","Credential envelope is invalid.")}
  try{const outputText=await executeOpenAIAgents(request,credential,options.factories);return safe(res,200,{protocolVersion:PROTOCOL_VERSION,ok:true,result:{state:"completed",outputText}})}
  catch(e){const f=e instanceof RuntimeFailure?e:new RuntimeFailure("internal_error","The Agents runtime failed unexpectedly.");return error(res,422,"execution_failed",f.safeMessage.length>512?"Runtime execution failed.":f.safeMessage,f.category)}finally{credential=""}
 });
 server.requestTimeout=35_000;server.headersTimeout=10_000;
 return {server,replays,listen:()=>new Promise<void>((resolve,reject)=>server.listen(options.port,options.host,resolve).once("error",reject)),close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())),shutdown(){shuttingDown=true;server.closeIdleConnections()}};
}
async function main(){const authSecret=secretValue("ADT_RUNTIME_AUTH_SECRET"),keyId=secretValue("ADT_RUNTIME_KEY_ID"),port=Number(process.env.ADT_RUNTIME_PORT??8080);if(authSecret.length<32||!/^[A-Za-z0-9_-]{32,128}$/.test(keyId)||!Number.isInteger(port)||port<1||port>65535)throw new Error("runtime_configuration_invalid");const runtime=await createRuntimeServer({host:process.env.ADT_RUNTIME_HOST??"0.0.0.0",port,authSecret,privateKeyPem:secretValue("ADT_RUNTIME_PRIVATE_KEY"),keyId,revision:process.env.ADT_RUNTIME_REVISION??"development"});await runtime.listen();const stop=()=>{runtime.shutdown();setTimeout(()=>process.exit(0),30_000).unref();runtime.close().then(()=>process.exit(0),()=>process.exit(1))};process.once("SIGTERM",stop);process.once("SIGINT",stop)}
if(process.argv[1]===new URL(import.meta.url).pathname)main().catch(()=>{process.stderr.write("ADT Runtime configuration or startup failed.\n");process.exit(1)});
