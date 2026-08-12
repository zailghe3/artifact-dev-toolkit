import {createServer,type IncomingMessage,type ServerResponse} from "node:http";
import {timingSafeEqual} from "node:crypto";
import {AuthenticationService} from "./authentication.js";
import {StdioAppServerClient,type AppServerClient} from "./app-server-client.js";
import {capabilities} from "./capabilities.js";
import {loadConfiguration,type RunnerConfiguration} from "./configuration.js";
import {SafeError,safeError} from "./errors.js";
import {diagnoseAuthEnvironment,type AuthEnvironmentDiagnostics} from "./auth-environment-diagnostics.js";

const json=(response:ServerResponse,status:number,value:unknown)=>{response.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});response.end(JSON.stringify(value));};
function authorized(request:IncomingMessage,secret:string){const supplied=request.headers["x-codex-runner-secret"];if(typeof supplied!=="string")return false;const a=Buffer.from(supplied),b=Buffer.from(secret);return a.length===b.length&&timingSafeEqual(a,b)}
async function boundedBody(request:IncomingMessage,limit:number){let size=0;for await(const chunk of request){size+=Buffer.byteLength(chunk);if(size>limit)throw new SafeError("request_too_large",413)}if(size>0&&!request.headers["content-type"]?.startsWith("application/json"))throw new SafeError("json_content_type_required",415)}
export function createRunnerServer(configuration:RunnerConfiguration,appServer:AppServerClient=new StdioAppServerClient(configuration.codexCommand,configuration.runnerVersion),diagnostics:()=>Promise<AuthEnvironmentDiagnostics>=()=>diagnoseAuthEnvironment({codexCommand:configuration.codexCommand,codexAppServerReady:()=>appServer.readiness()})){
 const auth=new AuthenticationService(appServer);return createServer({requestTimeout:15_000,headersTimeout:10_000},async(request,response)=>{const path=new URL(request.url??"/","http://runner.invalid").pathname;try{
  if(request.method==="GET"&&path==="/health")return json(response,200,{ok:true});
  if(!path.startsWith("/v1/")||!authorized(request,configuration.sharedSecret))throw new SafeError("unauthorized",401);
  await boundedBody(request,configuration.requestBodyLimit);
  if(request.method==="GET"&&path==="/v1/capabilities"){const codexAvailable=await appServer.readiness();return json(response,200,capabilities(configuration.runnerVersion,codexAvailable,configuration.deviceAuthCompatible));}
  if(request.method==="GET"&&path==="/v1/diagnostics/auth-environment")return json(response,200,await diagnostics());
  if(request.method==="GET"&&path==="/v1/auth/status")return json(response,200,await auth.status());
  if(request.method==="POST"&&path==="/v1/auth/device/start")return json(response,200,await auth.startDevice());
  if(request.method==="POST"&&path==="/v1/auth/logout")return json(response,200,await auth.logout());
  throw new SafeError("not_found",404);
 }catch(error){const safe=safeError(error),details=safe.details;console.error(JSON.stringify({level:"error",event:"runner_operation_failed",operation:`${request.method??"UNKNOWN"} ${path}`,category:safe.code,...details}));json(response,safe.status,{error:safe.code,...details});}}).on("close",()=>void appServer.close());
}
if(process.argv[1]===new URL(import.meta.url).pathname){const config=await loadConfiguration();const server=createRunnerServer(config);server.listen(config.port,config.host,()=>console.log(JSON.stringify({level:"info",event:"runner_started",port:config.port,sharedSecretLoaded:true})));const stop=()=>server.close(()=>process.exit(0));process.on("SIGTERM",stop);process.on("SIGINT",stop);}
