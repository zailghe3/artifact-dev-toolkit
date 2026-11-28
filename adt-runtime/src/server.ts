import { usesInteractiveBlocks, WORKFLOW_INTERACTION_CAPABILITY } from "./workflow-interaction-contract.js";
import {createHash,createPublicKey} from "node:crypto";
import {managementDependenciesSchema,runtimeControlSchema,runtimeControlErrorCodeSchema,runtimeControlOperationErrorResponse,
 RUNTIME_CONTROL_PATH,RUNTIME_CONTROL_BYTES,
 type ManagementEvidence,type RuntimeControlCommand} from "./runtime-control-contract.js";
import type {RuntimeRootKey} from "./runtime-key.js";
import type {Pool} from "./postgres.js";
import { OPERATIONAL_SETTINGS_BYTES, OPERATIONAL_SETTINGS_PATH, operationalSettingsCommandSchema, operationalSettingsFailures,
 operationalSettingsResults, type OperationalSettingsCommand, type OperationalSettingsFailureCode } from "./operational-settings-contract.js";
import { operationalSettings, OperationalSettingsConflict, recordManagementNonce } from "./operational-settings.js";
import { initializeRuntimeDatabase, runtimePostgresPool, RuntimeDatabaseError } from "./postgres.js";
import { readRuntimePostgresConfiguration } from "./postgres-configuration.js";
import { RuntimeKeyError, loadRuntimeWrappingPrivateKey } from "./runtime-key.js";
import {progressAgentModel} from "./agent-models.js";
import {AGENT_PROGRESS_CAPABILITY,AGENT_PROGRESS_PATH,AGENT_TOOL_PATH,AGENT_SECURITY_PATH,validateToolArguments,sanitizeToolResult} from "./agent-contract.js";
import {progressWireSchema,exactToolWireSchema,securityWireSchema} from "./agent-http.js";
import {parseOllamaAllowedBaseUrls} from "./ollama-configuration.js";
import {approvedOllamaConfiguration,discoverOllamaModels} from "./ollama.js";
import {PROVIDER_MODELS_PATH,PROVIDER_MODELS_CAPABILITY,providerModelsSchema} from "./protocol.js";
import {createServer,type IncomingMessage,type ServerResponse} from "node:http";
import {readFileSync} from "node:fs";
import {secretValue,authenticate,ReplayCache,MAX_BODY_BYTES,PROTOCOL_VERSION,READINESS_PATH,EXECUTE_PATH,PROVIDER_EXECUTE_PATH,PROVIDER_EXECUTION_CAPABILITY,executionSchema,providerExecutionSchema,decryptCredential,loadWrappingKey,MCP_DISCOVER_PATH,MCP_CALL_PATH,mcpDiscoverySchema,mcpCallSchema,SECURITY_TEST_PATH,ADRIAN_SECURITY_CAPABILITY,ADRIAN_SECURITY_TEST_CAPABILITY,securityTestSchema} from "./protocol.js";
import type {Factories} from "./openai-agents.js";
import {RuntimeFailure} from "./provider-execution.js";
import {executeProvider,PROVIDER_CAPABILITIES,providerExecutionTimeoutMs} from "./providers.js";
import {PROVIDER_RESPONSE_ALLOWANCE_MS,GRAPH_PROVIDER_RESPONSE_TIMEOUT_MS} from "./provider-timeouts.js";
import type {ProviderHttpDependencies} from "./provider-http.js";
import {advanceGenericGraph,graphExecutionSchema,GraphNodeGatewayFailure,CheckpointGatewayFailure,LANGGRAPH_EXECUTE_PATH,LANGGRAPH_APPROVAL_CAPABILITY,LANGGRAPH_CONTEXT_SELECTION_CAPABILITY,LANGGRAPH_GRAPH_CAPABILITY} from "./langgraph.js";
import {diagnoseExecutionPath,executionPathDiagnosticSchema,EXECUTION_PATH_DIAGNOSTIC_CAPABILITY,EXECUTION_PATH_DIAGNOSTIC_PATH} from "./execution-path-diagnostic.js";
import {callMcpTool,discoverMcpTools,MCP_CALL_CAPABILITY,MCP_DISCOVERY_CAPABILITY,McpFailure,type McpTool,type NetworkFetch,type McpNetworkDependencies} from "./mcp.js";
import {adrian} from "@secureagentics/adrian";
import {acquireAdrianExecutionLease,AdrianExecutionLeaseUnavailableError,ProductionAdrianSecurityGate,SecurityDecisionError,authorizeJournaledTool} from "./adrian.js";
import {ADRIAN_TEST_LOGIN_TIMEOUT_MS,ADRIAN_TEST_TOTAL_TIMEOUT_MS,probeAdrianControlChannel,type AdrianCommissioningResult} from "./adrian-commissioning.js";
import {RUNTIME_RELEASE} from "./release.js";
import {AdrianLocalLifecycleError,withAdrianLocalLog} from "./adrian-local-log.js";
import {REDEPLOY_CAPABILITY,REDEPLOY_PATH,redeployAvailable,requestRedeploy,type RedeployConfiguration} from "./redeploy.js";

export const RUNTIME_INBOUND_REQUEST_TIMEOUT_MS=60_000,RUNTIME_HEADERS_TIMEOUT_MS=10_000,RUNTIME_EXECUTION_RESPONSE_TIMEOUT_MS=150_000;
type Logger=(event:Record<string,unknown>)=>void;
export type AdrianRuntimeLifecycle=Pick<typeof adrian,"init"|"shutdown"|"getHandler"|"getWebSocketClient">;
type RuntimeApplication={store(command:RuntimeControlCommand):Promise<unknown>;start():void;stop():Promise<void>};
type ApplicationFactory=(options:{pool:Pool;rootKey:RuntimeRootKey;activeKeyVersion:number;env:Record<string,string|undefined>;onError(stage:string):void})=>RuntimeApplication;
type Options={control?:RuntimeApplication["store"];recordManagementNonce?:(nonce:string,timestamp:number)=>Promise<boolean>;operateSettings?:(command:OperationalSettingsCommand)=>Promise<unknown>;operationalDatabaseReady?:()=>Promise<boolean>;ollamaAllowedBaseUrls?:string;host:string;port:number;authSecret:string;privateKeyPem:string;revision:string;factories?:Partial<Factories>;providerHttp?:ProviderHttpDependencies;mcpFetcher?:NetworkFetch;mcpResolver?:McpNetworkDependencies["resolve"];redeployFetcher?:typeof fetch;redeploy?:RedeployConfiguration;now?:()=>number;logger?:Logger;adrianRuntime?:AdrianRuntimeLifecycle;adrianProbe?:typeof probeAdrianControlChannel};
type ErrorCode="runtime_authentication_failed"|"invalid_request"|"credential_invalid"|"unsupported_operation"|"protocol_incompatible"|"capability_unavailable"|"runtime_unavailable"|"execution_failed"|"adrian_initialization_failed"|"adrian_policy_unavailable";
const safe=(res:ServerResponse,status:number,value:unknown)=>{const body=JSON.stringify(value);res.writeHead(status,{"content-type":"application/json","content-length":Buffer.byteLength(body),"cache-control":"no-store"});res.end(body)};
const error=(res:ServerResponse,status:number,code:ErrorCode,category:string,message:string,providerExecutionEntered=false,orchestration?:unknown)=>safe(res,status,{protocolVersion:PROTOCOL_VERSION,ok:false,error:{code,category,safeMessage:message,retryable:false,providerExecutionEntered,...(orchestration?{orchestration}:{})}});
async function body(req:IncomingMessage,max:number,destroyOnReturn=true){const chunks:Buffer[]=[];let size=0;for await(const value of req.iterator({destroyOnReturn})){size+=value.length;if(size>max)throw new Error("body_too_large");chunks.push(value)}return Buffer.concat(chunks)}
const managementRequestId=(nonce:unknown)=>typeof nonce==="string"&&/^[A-Za-z0-9_-]{16,128}$/.test(nonce)
 ?createHash("sha256").update(nonce).digest("base64url").slice(0,32):undefined;
const boundedId=(value:unknown)=>typeof value==="string"&&/^[A-Za-z0-9:_-]{1,256}$/.test(value)?value:undefined;
export function runtimeBuildRevision(environment:NodeJS.ProcessEnv=process.env,readRevision:()=>string=()=>readFileSync("/runtime/REVISION","utf8")){try{const revision=readRevision().trim();if(revision)return revision.slice(0,128)}catch{/* Local source execution has no image-owned revision file. */}return (environment.ADT_RUNTIME_REVISION??"development").slice(0,128)}
export async function createRuntimeServer(options:Options){
 const ollamaAllowedBaseUrls=parseOllamaAllowedBaseUrls(options.ollamaAllowedBaseUrls);
 const {privateKey,keyId}=await loadWrappingKey(options.privateKeyPem);
 const wrappingPublicKey=createPublicKey(options.privateKeyPem).export({type:"spki",format:"pem"}).toString();
 const replays=new ReplayCache(),securityRuntime=options.adrianRuntime??adrian,log=options.logger??(event=>process.stdout.write(`${JSON.stringify(event)}\n`));let shuttingDown=false;
 const emit=(event:string,fields:Record<string,unknown>)=>log({event,protocolVersion:PROTOCOL_VERSION,runtimeRevision:options.revision,...fields});
 const server=createServer(async(req,res)=>{const started=Date.now();res.setHeader("x-content-type-options","nosniff");const path=new URL(req.url??"/","http://runtime.invalid").pathname,agentOperation=path===AGENT_PROGRESS_PATH?"model_progression":path===AGENT_TOOL_PATH?"tool_execution":path===AGENT_SECURITY_PATH?"security_decision":undefined,operation=agentOperation??(path===PROVIDER_MODELS_PATH?"provider_models":path===READINESS_PATH?"readiness":(path===EXECUTE_PATH||path===PROVIDER_EXECUTE_PATH)?"execute":path===SECURITY_TEST_PATH?"security_test":path===MCP_DISCOVER_PATH?"mcp_discover":path===MCP_CALL_PATH?"mcp_call":path===LANGGRAPH_EXECUTE_PATH?"langgraph_advance":path===EXECUTION_PATH_DIAGNOSTIC_PATH?"execution_path_diagnostic":path===REDEPLOY_PATH?"infrastructure_redeploy":"unsupported");
  if(req.method==="GET"&&path==="/healthz"){
   const ok=!shuttingDown && (await options.operationalDatabaseReady?.().catch(()=>false) ?? true);
   return safe(res,ok?200:503,{ok});
  }
  if(path===RUNTIME_CONTROL_PATH){
   const nonce=req.headers["x-adt-nonce"];
   const requestId=managementRequestId(nonce);
   const progress:Pick<ManagementEvidence,"authenticated"|"protocolCompatible"|"noncePersisted"|"accepted"|"dispatched">
    & {operation?:RuntimeControlCommand["operation"]}={
     authenticated:null,protocolCompatible:null,noncePersisted:null,accepted:false,dispatched:false,
    };
   const finish=(httpStatus:number,stage:ManagementEvidence["stage"],result:ManagementEvidence["result"],
    wire:{ok:false;code:string}|{ok:true;result:unknown})=>{
    const {operation,...observations}=progress;
    const evidence={requestId,stage,result,...observations};
    safe(res,httpStatus,{protocolVersion:PROTOCOL_VERSION,...wire,...(requestId?{management:evidence}:{})});
    const dependencies=operation==="runs.diagnose"&&wire.ok?managementDependenciesSchema.safeParse(wire.result).data:undefined;
    emit("runtime_management_request",{operation:operation??"management",...evidence,httpStatus,elapsedMs:Date.now()-started,
     ...(dependencies?{dependencies}:{})});
   };
   if(shuttingDown)return finish(503,"management","management_unavailable",{ok:false,code:"runtime_unavailable"});
   if(req.method!=="POST")return finish(405,"validation","request_rejected",{ok:false,code:"invalid_request"});
   let raw:Buffer;
   try{raw=await body(req,RUNTIME_CONTROL_BYTES)}
   catch{return finish(413,"validation","request_rejected",{ok:false,code:"invalid_request"})}
   progress.authenticated=authenticate(req.headers,"POST",path,raw,options.authSecret,replays,options.now?.());
   if(!progress.authenticated)return finish(401,"authentication","authentication_failed",{ok:false,code:"runtime_authentication_failed"});
   progress.protocolCompatible=req.headers["x-adt-protocol"]===PROTOCOL_VERSION;
   if(!progress.protocolCompatible)return finish(409,"protocol","protocol_incompatible",{ok:false,code:"protocol_incompatible"});
   let command:RuntimeControlCommand;
   try{command=runtimeControlSchema.parse(JSON.parse(raw.toString("utf8")))}
   catch{return finish(400,"validation","request_rejected",{ok:false,code:"invalid_request"})}
   progress.operation=command.operation;
   if(!options.control||!options.recordManagementNonce)
    return finish(503,"management","management_unavailable",{ok:false,code:"runtime_unavailable"});
   try{progress.noncePersisted=await options.recordManagementNonce(String(nonce),Number(req.headers["x-adt-timestamp"]))}
   catch{progress.noncePersisted=false;return finish(503,"nonce","nonce_persistence_unavailable",{ok:false,code:"runtime_unavailable"})}
   if(!progress.noncePersisted)return finish(401,"nonce","authentication_failed",{ok:false,code:"runtime_authentication_failed"});
   progress.accepted=true;
   progress.dispatched=true;
   try{return finish(200,"complete","ok",{ok:true,result:await options.control(command)??null})}
   catch(value){
    const message=value instanceof Error?value.message:undefined;
    if(command.operation==="runs.list"&&message!=="permission_denied"){
     return finish(503,"storage",message==="invalid_run_snapshot"?"storage_data_invalid":"storage_query_unavailable",
      {ok:false,code:"runtime_unavailable"});
    }
    const code=runtimeControlErrorCodeSchema.safeParse(message).data??"runtime_unavailable";
    const unavailable=code==="runtime_unavailable"||code==="github_broker_unavailable";
    const httpStatus=runtimeControlOperationErrorResponse(code)?.status??
     (code==="permission_denied"?403:code==="run_not_found"?404:unavailable?503:409);
    return finish(httpStatus,"dispatch",unavailable?"management_unavailable":"operation_rejected",{ok:false,code});
   }
  }
  if(path===OPERATIONAL_SETTINGS_PATH){
   const nonce=req.headers["x-adt-nonce"],requestId=managementRequestId(nonce);
   const settingsEvidence:{operation?:OperationalSettingsCommand["operation"]}={};
   const observe=(httpStatus:number,stage:string,classification:OperationalSettingsFailureCode|"ok")=>
    emit("runtime_operational_settings_request",{...settingsEvidence,requestId,stage,classification,httpStatus,elapsedMs:Date.now()-started});
   const fail=(code:OperationalSettingsFailureCode)=>{
    const {status,stage}=operationalSettingsFailures[code];
    observe(status,stage,code);
    return safe(res,status,{protocolVersion:PROTOCOL_VERSION,ok:false,code,requestId});
   };
   if(shuttingDown)return fail("runtime_settings_unavailable");
   let raw:Buffer;
   try{raw=await body(req,OPERATIONAL_SETTINGS_BYTES,false)}
   catch{return fail("runtime_settings_body_too_large")}
   if(!authenticate(req.headers,req.method??"",path,raw,options.authSecret,replays,options.now?.()))
    return fail("runtime_settings_authentication_failed");
   if(req.headers["x-adt-protocol"]!==PROTOCOL_VERSION)return fail("runtime_settings_protocol_incompatible");
   if(req.method!=="POST")return fail("runtime_settings_request_rejected");
   let command:OperationalSettingsCommand;
   try{command=operationalSettingsCommandSchema.parse(JSON.parse(raw.toString("utf8")))}
   catch{return fail("runtime_settings_request_rejected")}
   settingsEvidence.operation=command.operation;
   if(!options.operateSettings||!options.recordManagementNonce)return fail("runtime_settings_unavailable");
   try {
    if(!await options.recordManagementNonce(String(nonce),Number(req.headers["x-adt-timestamp"])))
     return fail("runtime_settings_replay_rejected");
   }catch{return fail("runtime_settings_nonce_unavailable")}
   let result:unknown;
   try{result=await options.operateSettings(command)}
   catch(value){return fail(value instanceof OperationalSettingsConflict?value.code:"runtime_settings_storage_unavailable")}
   const parsed=operationalSettingsResults[command.operation].safeParse(result);
   if(!parsed.success)return fail("runtime_settings_data_invalid");
   observe(200,"complete","ok");
   return safe(res,200,{protocolVersion:PROTOCOL_VERSION,ok:true,result:parsed.data,requestId});
  }
  if(shuttingDown){emit("runtime_request_rejected",{operation,result:"runtime_unavailable",httpStatus:503,elapsedMs:Date.now()-started,providerExecutionEntered:false});return error(res,503,"runtime_unavailable","connection_unavailable","Runtime is shutting down.")}
  let raw:Buffer;try{raw=await body(req,MAX_BODY_BYTES)}catch{emit("runtime_request_rejected",{operation,result:"request_too_large",httpStatus:413,elapsedMs:Date.now()-started,providerExecutionEntered:false});return error(res,413,"invalid_request","configuration_invalid","Request body exceeds the permitted size.")}
  if(!authenticate(req.headers,req.method??"",path,raw,options.authSecret,replays,options.now?.())){emit("runtime_request_rejected",{operation,result:"authentication_failed",httpStatus:401,elapsedMs:Date.now()-started,providerExecutionEntered:false});return error(res,401,"runtime_authentication_failed","authentication_failed","Runtime request authentication failed.")}
  if(req.headers["x-adt-protocol"]!==PROTOCOL_VERSION){emit("runtime_request_rejected",{operation,result:"protocol_incompatible",httpStatus:409,elapsedMs:Date.now()-started,providerExecutionEntered:false});return error(res,409,"protocol_incompatible","configuration_invalid","Runtime protocol is incompatible.")}
  if(req.method==="GET"&&path===READINESS_PATH){
   if(options.operationalDatabaseReady && !await options.operationalDatabaseReady().catch(()=>false))
    return error(res,503,"runtime_unavailable","connection_unavailable","Runtime PostgreSQL is unavailable.");
   const redeployTargets=(['runtime','runner'] as const).filter(target=>redeployAvailable(target,options.redeploy??{}));emit("runtime_readiness_succeeded",{operation,requestId:boundedId(req.headers["x-adt-nonce"]),httpStatus:200,elapsedMs:Date.now()-started,providerExecutionEntered:false});return safe(res,200,{protocolVersion:PROTOCOL_VERSION,runtimeRevision:options.revision,runtimeReleaseRevision:RUNTIME_RELEASE.releaseRevision,capabilities:[AGENT_PROGRESS_CAPABILITY,PROVIDER_MODELS_CAPABILITY,PROVIDER_EXECUTION_CAPABILITY,...PROVIDER_CAPABILITIES,"tool:artifact-search",MCP_DISCOVERY_CAPABILITY,MCP_CALL_CAPABILITY,LANGGRAPH_GRAPH_CAPABILITY,LANGGRAPH_APPROVAL_CAPABILITY,LANGGRAPH_CONTEXT_SELECTION_CAPABILITY,...(options.control?[WORKFLOW_INTERACTION_CAPABILITY]:[]),EXECUTION_PATH_DIAGNOSTIC_CAPABILITY,"execution-timeout",ADRIAN_SECURITY_CAPABILITY,ADRIAN_SECURITY_TEST_CAPABILITY,REDEPLOY_CAPABILITY],redeployTargets,credentialWrappingKeyId:keyId,credentialWrappingPublicKey:wrappingPublicKey})}
  if(req.method==="POST"&&agentOperation){
   let request;try{const value=JSON.parse(raw.toString("utf8"));request=(path===AGENT_PROGRESS_PATH?progressWireSchema:path===AGENT_TOOL_PATH?exactToolWireSchema:securityWireSchema).parse(value)}catch{
    emit("runtime_request_rejected",{operation,requestId:boundedId(req.headers["x-adt-nonce"]),result:"invalid_request",httpStatus:400,elapsedMs:Date.now()-started,providerExecutionEntered:false});
    return error(res,400,"invalid_request","configuration_invalid","Agent progression request is invalid.");
   }
   const requestId=request.requestId;
   emit("runtime_agent_operation_received",{operation,requestId,elapsedMs:Date.now()-started});
   let credential="",release:(()=>void)|undefined,entered=false;
   try{
    if(request.credential)try{credential=await decryptCredential(request.credential,privateKey,keyId,`${PROTOCOL_VERSION}:${AGENT_PROGRESS_CAPABILITY}:${requestId}`)}catch{
     emit("runtime_request_rejected",{operation,requestId,result:"credential_invalid",httpStatus:400,elapsedMs:Date.now()-started,providerExecutionEntered:false});
     return error(res,400,"credential_invalid","configuration_invalid","Credential envelope is invalid.");
    }
    let result:unknown;
    if("request" in request){res.setTimeout(request.request.timeoutMs+30000);result=await progressAgentModel(request.request,credential,ollamaAllowedBaseUrls,{...options.providerHttp,onProviderEntry:()=>{if(!entered)emit("runtime_provider_execution_started",{operation,requestId,elapsedMs:Date.now()-started,providerExecutionEntered:true});entered=true}})}
    else if("admissionId" in request){validateToolArguments(request.tool.inputSchema,request.arguments);result=sanitizeToolResult(await callMcpTool(request.server,request.tool,request.arguments,credential,{fetch:options.mcpFetcher,resolve:options.mcpResolver,deadlineAt:request.executionDeadlineAt}),credential)}
    else{
     const security=request;release=acquireAdrianExecutionLease();
     try{result=await withAdrianLocalLog(securityRuntime,{apiKey:credential,wsUrl:security.profile.endpointUrl,sessionId:`adt:${security.context.id}:${security.requestId}`,blockTimeout:security.profile.decisionTimeoutMs/1000},async()=>{const handler=securityRuntime.getHandler(),client=securityRuntime.getWebSocketClient();if(!handler||!client||!await client.waitForPolicyReady(security.profile.decisionTimeoutMs/1000))throw new AdrianExecutionLeaseUnavailableError();return authorizeJournaledTool(handler,client,security.context,security.profile.decisionTimeoutMs)});}catch(value){if(value instanceof SecurityDecisionError||value instanceof AdrianExecutionLeaseUnavailableError)throw value;throw new AdrianExecutionLeaseUnavailableError()}
    }
    emit("runtime_agent_operation_completed",{operation,requestId,httpStatus:200,elapsedMs:Date.now()-started,providerExecutionEntered:entered});
    return safe(res,200,{protocolVersion:PROTOCOL_VERSION,ok:true,result});
   }catch(value){
    const known=value instanceof RuntimeFailure||value instanceof McpFailure||value instanceof SecurityDecisionError||value instanceof AdrianExecutionLeaseUnavailableError;
    const category=known?value.category:entered?"provider_start_ambiguous":"configuration_invalid",ambiguous=value instanceof McpFailure?value.ambiguous:entered&&!(value instanceof RuntimeFailure&&
      ["model_unavailable","provider_api_unsupported","tool_proposals_unsupported","unsupported_model_option","provider_rejected","authentication_failed","permission_denied","rate_limited"].includes(value.category));
    emit("runtime_agent_operation_failed",{operation,requestId,result:"execution_failed",failureCategory:category,httpStatus:422,elapsedMs:Date.now()-started,providerExecutionEntered:entered,ambiguous});
    return safe(res,422,{protocolVersion:PROTOCOL_VERSION,ok:false,error:{code:"execution_failed",category,safeMessage:known?value.safeMessage:"Agent operation failed safely.",retryable:false,providerExecutionEntered:entered,ambiguous}});
   }finally{credential="";release?.()}
  }
  if(req.method==="POST"&&path===PROVIDER_MODELS_PATH){
   let request;try{request=providerModelsSchema.parse(JSON.parse(raw.toString("utf8")))}catch{return error(res,400,"invalid_request","configuration_invalid","Provider model request is invalid.")}
   let credential="";
   try{
    approvedOllamaConfiguration(request.configuration,ollamaAllowedBaseUrls);
    if(request.credential)try{credential=await decryptCredential(request.credential,privateKey,keyId,`${PROTOCOL_VERSION}:${request.capability}:${request.provider}:${request.requestId}`)}catch{return error(res,400,"credential_invalid","configuration_invalid","Credential envelope is invalid.")}
    const models=await discoverOllamaModels(request.configuration,credential,ollamaAllowedBaseUrls,options.providerHttp);
    return safe(res,200,{protocolVersion:PROTOCOL_VERSION,ok:true,result:{models}});
   }catch(value){const failure=value instanceof RuntimeFailure?value:new RuntimeFailure("internal_error","Provider discovery failed safely.");return error(res,422,"execution_failed",failure.category,failure.safeMessage,false)}finally{credential=""}
  }
  if(req.method==="POST"&&path===REDEPLOY_PATH){
   let request:{target:"runtime"|"runner";requestId:string};try{const value=JSON.parse(raw.toString("utf8"));if(!value||typeof value!=="object"||Array.isArray(value)||!(["runtime","runner"] as unknown[]).includes(value.target)||!boundedId(value.requestId)||Object.keys(value).some(key=>!["target","requestId"].includes(key)))throw Error();request=value}catch{return error(res,400,"invalid_request","configuration_invalid","Redeploy request is invalid.")}
   if(!redeployAvailable(request.target,options.redeploy??{}))return error(res,503,"capability_unavailable","configuration_invalid","Runtime-mediated redeploy is not configured.");
   const result=await requestRedeploy(request.target,options.redeploy??{},options.redeployFetcher,options.now,role=>emit("runtime_redeploy_role_dispatching",{operation,requestId:request.requestId,target:request.target,role,stage:"webhook_dispatch",providerExecutionEntered:false}));for(const outcome of result.outcomes)emit("runtime_redeploy_role_completed",{operation,requestId:request.requestId,target:request.target,role:outcome.role,result:outcome.outcome,httpStatus:outcome.httpStatus,elapsedMs:outcome.elapsedMs,providerExecutionEntered:false});
   return safe(res,result.accepted?202:502,{protocolVersion:PROTOCOL_VERSION,ok:result.accepted,...(result.accepted?{result:{state:"accepted",target:request.target,outcomes:result.outcomes}}:{error:{code:"execution_failed",category:result.ambiguous?"provider_start_ambiguous":"provider_rejected",safeMessage:result.ambiguous?"Webhook request outcome is uncertain. Check freshness before trying again.":"Webhook request rejected.",retryable:false,providerExecutionEntered:false,ambiguous:result.ambiguous,outcomes:result.outcomes}})});
  }
  if(req.method==="POST"&&path===SECURITY_TEST_PATH){
   let request;try{request=securityTestSchema.parse(JSON.parse(raw.toString("utf8")))}catch{return error(res,400,"invalid_request","configuration_invalid","Security Profile test request is invalid.")}
   let credential="",release:(()=>void)|undefined;const requestId=boundedId(request.requestId),testStarted=Date.now();
   const respond=(result:AdrianCommissioningResult)=>{const diagnostic={stage:result.stage,safeCode:result.safeCode,elapsedMs:Math.min(60_000,Math.max(0,Date.now()-testStarted)),...(result.httpStatus===undefined?{}:{httpStatus:result.httpStatus}),...(result.websocketCloseCode===undefined?{}:{websocketCloseCode:result.websocketCloseCode}),...(result.policyMode===undefined?{}:{policyMode:result.policyMode})};emit(result.ok?"runtime_security_test_sdk_ready":"runtime_security_test_failed",{operation,requestId,...diagnostic});return safe(res,result.ok?200:503,{protocolVersion:PROTOCOL_VERSION,ok:result.ok,...(result.ok?{result:{state:"ready",provider:"adrian",profileId:request.profileId,...diagnostic}}:{error:{code:result.safeCode,category:"security_unavailable",safeMessage:"Adrian commissioning failed safely.",retryable:false,providerExecutionEntered:false,diagnostic}})})};
   emit("runtime_security_test_started",{operation,requestId,stage:"runtime",elapsedMs:0});
   try{
    credential=await decryptCredential(request.credential,privateKey,keyId,`${PROTOCOL_VERSION}:${request.capability}:${request.requestId}`);
    let totalTimer:NodeJS.Timeout|undefined;const probe=await Promise.race([(options.adrianProbe??probeAdrianControlChannel)({endpointUrl:request.endpointUrl,apiKey:credential,sessionId:`adt:test:${request.requestId}`}),new Promise<AdrianCommissioningResult>(resolve=>{totalTimer=setTimeout(()=>resolve({ok:false,stage:"transport",safeCode:"adrian_ws_unreachable",elapsedMs:ADRIAN_TEST_TOTAL_TIMEOUT_MS}),ADRIAN_TEST_TOTAL_TIMEOUT_MS)})]).finally(()=>clearTimeout(totalTimer));
    if(!probe.ok)return respond(probe);
    emit("runtime_security_test_ws_upgrade_succeeded",{operation,requestId,stage:"upgrade",elapsedMs:Date.now()-testStarted});emit("runtime_security_test_login_ack_received",{operation,requestId,stage:"login",elapsedMs:Date.now()-testStarted});emit("runtime_security_test_policy_observed",{operation,requestId,stage:"policy",policyMode:probe.policyMode,elapsedMs:Date.now()-testStarted});
    try{release=acquireAdrianExecutionLease()}catch{return respond({...probe,ok:false,stage:"sdk",safeCode:"adrian_sdk_readiness_failed"})}
    let result:AdrianCommissioningResult;try{result=await withAdrianLocalLog(securityRuntime,{apiKey:credential,wsUrl:request.endpointUrl,sessionId:`adt:test:sdk:${request.requestId}`,blockTimeout:request.decisionTimeoutMs/1000},async()=>{const handler=securityRuntime.getHandler(),client=securityRuntime.getWebSocketClient();let ready=false;try{ready=Boolean(handler&&client&&await client.waitForPolicyReady(ADRIAN_TEST_LOGIN_TIMEOUT_MS/1000)&&client.loginAcked()&&client.policyActive()&&client.blockTimeout(request.decisionTimeoutMs/1000)===request.decisionTimeoutMs/1000)}catch{}return ready?{...probe,stage:"ready",safeCode:"ready",ok:true}:{...probe,ok:false,stage:"sdk",safeCode:"adrian_sdk_readiness_failed"}})}catch(value){if(value instanceof AdrianLocalLifecycleError)emit("runtime_security_test_local_initialization_failed",{operation,requestId,stage:"sdk",reason:value.reason});result={...probe,ok:false,stage:"sdk",safeCode:"adrian_sdk_readiness_failed"}}
    return respond(result)
   }catch(value){const failure=value instanceof AdrianExecutionLeaseUnavailableError?value:new AdrianExecutionLeaseUnavailableError();return error(res,503,"execution_failed",failure.category,failure.safeMessage,false)}finally{credential="";if(release)release()}
  }
  if(req.method==="POST"&&(path===MCP_DISCOVER_PATH||path===MCP_CALL_PATH)){let request;try{request=(path===MCP_DISCOVER_PATH?mcpDiscoverySchema:mcpCallSchema).parse(JSON.parse(raw.toString("utf8")))}catch{return error(res,400,"invalid_request","configuration_invalid","MCP request is invalid.")}let credential:string|undefined;if(request.credential)try{credential=await decryptCredential(request.credential,privateKey,keyId,`${PROTOCOL_VERSION}:${request.capability}:${request.requestId}`)}catch{return error(res,400,"credential_invalid","configuration_invalid","Credential envelope is invalid.")}try{const call=request as typeof request&{tool:McpTool;arguments:Record<string,unknown>},dependencies={fetch:options.mcpFetcher,resolve:options.mcpResolver},result=path===MCP_DISCOVER_PATH?await discoverMcpTools(request.server,credential,dependencies):await callMcpTool(request.server,call.tool,call.arguments,credential,dependencies);emit("runtime_mcp_completed",{operation,requestId:boundedId(request.requestId),result:"completed",httpStatus:200,elapsedMs:Date.now()-started,providerExecutionEntered:false});return safe(res,200,{protocolVersion:PROTOCOL_VERSION,ok:true,result})}catch(value){const failure=value instanceof McpFailure?value:new McpFailure("internal_error","MCP operation failed safely.");emit("runtime_mcp_failed",{operation,requestId:boundedId(request.requestId),result:failure.category,httpStatus:502,elapsedMs:Date.now()-started,providerExecutionEntered:false,ambiguous:failure.ambiguous});return safe(res,502,{protocolVersion:PROTOCOL_VERSION,ok:false,error:{code:"execution_failed",category:failure.category,safeMessage:failure.safeMessage,retryable:false,ambiguous:failure.ambiguous}})}}
  if(req.method==="POST"&&path===EXECUTION_PATH_DIAGNOSTIC_PATH){let request;try{request=executionPathDiagnosticSchema.parse(JSON.parse(raw.toString("utf8")))}catch{emit("runtime_request_rejected",{operation,result:"schema_invalid",httpStatus:400,elapsedMs:Date.now()-started,providerExecutionEntered:false});return error(res,400,"invalid_request","configuration_invalid","Execution-path diagnostic request is invalid.")}emit("runtime_execution_path_diagnostic_started",{operation,requestId:boundedId(request.requestId),providerExecutionEntered:false});const results=await diagnoseExecutionPath(request);for(const result of results)emit("runtime_execution_path_target_completed",{operation,requestId:boundedId(request.requestId),target:result.target,result:result.failureCode??"available",httpStatus:result.httpStatus,elapsedMs:result.elapsedMs,providerExecutionEntered:false});emit("runtime_execution_path_diagnostic_completed",{operation,requestId:boundedId(request.requestId),result:"completed",httpStatus:200,elapsedMs:Date.now()-started,providerExecutionEntered:false});return safe(res,200,{protocolVersion:PROTOCOL_VERSION,ok:true,results})}
  if(req.method==="POST"&&path===LANGGRAPH_EXECUTE_PATH){if(options.control)return error(res,404,"unsupported_operation","configuration_invalid","Workflow progression is scheduled by Runtime.");let request;try{request=graphExecutionSchema.parse(JSON.parse(raw.toString("utf8")))}catch{emit("runtime_request_rejected",{operation,result:"schema_invalid",httpStatus:400,elapsedMs:Date.now()-started,providerExecutionEntered:false});return error(res,400,"invalid_request","configuration_invalid","LangGraph request is invalid.")}res.setTimeout(GRAPH_PROVIDER_RESPONSE_TIMEOUT_MS);if(usesInteractiveBlocks(request.plan))return error(res,409,"capability_unavailable","configuration_invalid","Interactive Workflows require PostgreSQL-backed ADT Runtime.");try{const result=await advanceGenericGraph(request);emit("runtime_langgraph_advance_completed",{operation,requestId:boundedId(request.requestId),result:result.state,httpStatus:200,elapsedMs:Date.now()-started,providerExecutionEntered:false});return safe(res,200,{protocolVersion:PROTOCOL_VERSION,ok:true,result})}catch(value){const known=value instanceof GraphNodeGatewayFailure||value instanceof CheckpointGatewayFailure,invalid=value instanceof GraphNodeGatewayFailure&&!value.retryable,status=invalid?409:503,category=invalid?"configuration_invalid":"provider_unavailable",message=invalid?"Graph node authority or admission is invalid.":"LangGraph execution is temporarily unavailable.",orchestration=known?value.orchestration:undefined;emit("runtime_langgraph_advance_failed",{operation,requestId:boundedId(request.requestId),result:orchestration?.code??"execution_failed",stage:orchestration?.stage,httpStatus:orchestration?.httpStatus??status,elapsedMs:Date.now()-started,providerExecutionEntered:false});return error(res,status,"execution_failed",category,message,false,orchestration)}}
  if(req.method!=="POST"||(path!==EXECUTE_PATH&&path!==PROVIDER_EXECUTE_PATH)){emit("runtime_request_rejected",{operation,result:"unsupported_operation",httpStatus:404,elapsedMs:Date.now()-started,providerExecutionEntered:false});return error(res,404,"unsupported_operation","configuration_invalid","Runtime operation is unsupported.")}
  let request;try{request=(path===EXECUTE_PATH?executionSchema:providerExecutionSchema).parse(JSON.parse(raw.toString("utf8")))}catch{emit("runtime_request_rejected",{operation,result:"schema_invalid",httpStatus:400,elapsedMs:Date.now()-started,providerExecutionEntered:false});return error(res,400,"invalid_request","configuration_invalid","Runtime request is invalid.")}
  if(request.capability==="openai-agents"&&((request.tools?.length??0)>0||(request.mcpTools?.length??0)>0||request.runtimeSecurity))return error(res,409,"unsupported_operation","configuration_invalid","Tool-enabled Agents require the durable Agent progression contract.");
  const requestId=boundedId(request.requestId),aad=`${PROTOCOL_VERSION}:${request.capability}:${request.idempotencyKey}`;let credential="";try{if(request.capability==="ollama-chat")try{approvedOllamaConfiguration(request.configuration,ollamaAllowedBaseUrls)}catch{return error(res,422,"execution_failed","configuration_invalid","Ollama endpoint is not approved.",false)}if(request.credential)credential=await decryptCredential(request.credential,privateKey,keyId,aad)}catch{emit("runtime_request_rejected",{operation,requestId,result:"credential_invalid",httpStatus:400,elapsedMs:Date.now()-started,providerExecutionEntered:false});return error(res,400,"credential_invalid","configuration_invalid","Credential envelope is invalid.")}
  // Keep inbound parsing/header limits narrow; allow only this validated provider's bounded execution.
  if(request.capability!=="openai-agents")res.setTimeout(providerExecutionTimeoutMs(request)+PROVIDER_RESPONSE_ALLOWANCE_MS);
  const openai=request.capability==="openai-agents"?request:undefined;
  const mcpCredentials=new Map<string,string>();
  try{for(const grant of openai?.mcpTools??[])if(grant.credential)mcpCredentials.set(grant.alias,await decryptCredential(grant.credential,privateKey,keyId,`${PROTOCOL_VERSION}:${request.capability}:${request.idempotencyKey}:mcp:${grant.alias}`))}
  catch{return error(res,400,"credential_invalid","configuration_invalid","Credential envelope is invalid.")}
  let releaseSecurity:(()=>void)|undefined,securityCredential="",security:ProductionAdrianSecurityGate|undefined,providerEntered=false;
  try{
   if(openai?.runtimeSecurity)try{securityCredential=await decryptCredential(openai.runtimeSecurity.credential,privateKey,keyId,`${PROTOCOL_VERSION}:${request.capability}:${request.idempotencyKey}:security:adrian`)}catch{return error(res,400,"credential_invalid","configuration_invalid","Credential envelope is invalid.")}
   const execute=async()=>{if(openai?.runtimeSecurity){const handler=securityRuntime.getHandler(),client=securityRuntime.getWebSocketClient();let policyReady=false;try{policyReady=Boolean(client&&await client.waitForPolicyReady(openai?.runtimeSecurity.decisionTimeoutMs/1000)&&client.blockTimeout(openai?.runtimeSecurity.decisionTimeoutMs/1000)===openai?.runtimeSecurity.decisionTimeoutMs/1000)}catch{}if(!handler||!client||!policyReady)throw new AdrianExecutionLeaseUnavailableError();security=new ProductionAdrianSecurityGate(handler,client,openai?.runtimeSecurity.decisionTimeoutMs,decision=>emit("runtime_security_decision",{operation,requestId,provider:"adrian",profileId:openai!.runtimeSecurity!.profileId,outcome:decision.outcome,elapsedMs:decision.elapsedMs,providerExecutionEntered:true}))}
    const onProviderEntry=()=>{if(!providerEntered)emit("runtime_provider_execution_started",{operation,requestId,providerExecutionEntered:true});providerEntered=true};
    const outputText=await executeProvider(request,credential,{onProviderEntry,ollamaAllowedBaseUrls,http:options.providerHttp,openai:{...options.factories,mcpCredentials,...(security?{securityGate:security,modelInstrumentation:security}:{})}});emit("runtime_provider_execution_completed",{operation,requestId,result:"completed",httpStatus:200,elapsedMs:Date.now()-started,providerExecutionEntered:true});return outputText};
   let outputText:string;if(openai?.runtimeSecurity){try{releaseSecurity=acquireAdrianExecutionLease()}catch(value){if(value instanceof AdrianExecutionLeaseUnavailableError)return error(res,503,"execution_failed",value.category,value.safeMessage,false);throw value}try{outputText=await withAdrianLocalLog(securityRuntime,{apiKey:securityCredential,wsUrl:openai?.runtimeSecurity.endpointUrl,sessionId:`adt:${request.idempotencyKey}`,blockTimeout:openai?.runtimeSecurity.decisionTimeoutMs/1000},execute)}catch(value){if(value instanceof AdrianLocalLifecycleError)throw new AdrianExecutionLeaseUnavailableError();throw value}}else outputText=await execute();
   return safe(res,200,{protocolVersion:PROTOCOL_VERSION,ok:true,result:{state:"completed",outputText}})
  }catch(value){const failure=value instanceof RuntimeFailure||value instanceof SecurityDecisionError||value instanceof AdrianExecutionLeaseUnavailableError?value:new RuntimeFailure(providerEntered?"provider_start_ambiguous":"internal_error",providerEntered?"Provider execution outcome is unknown.":"Runtime execution failed safely.");emit("runtime_provider_execution_failed",{operation,requestId,result:"execution_failed",failureCategory:failure.category,httpStatus:422,elapsedMs:Date.now()-started,providerExecutionEntered:providerEntered});return error(res,422,"execution_failed",failure.category,failure.safeMessage.length>512?"Runtime execution failed.":failure.safeMessage,providerEntered)}finally{credential="";securityCredential="";mcpCredentials.clear();if(releaseSecurity)releaseSecurity()}

 });server.requestTimeout=RUNTIME_INBOUND_REQUEST_TIMEOUT_MS;server.headersTimeout=RUNTIME_HEADERS_TIMEOUT_MS;server.timeout=RUNTIME_EXECUTION_RESPONSE_TIMEOUT_MS;
 return{server,keyId,replays,listen:()=>new Promise<void>((resolve,reject)=>server.listen(options.port,options.host,resolve).once("error",reject)),close:()=>new Promise<void>((resolve,reject)=>server.close(value=>value?reject(value):resolve())),shutdown(){shuttingDown=true;server.closeIdleConnections()}};
}
function startup(event:string,stage:string){process.stderr.write(`${JSON.stringify({event,protocolVersion:PROTOCOL_VERSION,stage})}\n`)}
async function main() {
 let authSecret: string;
 let privateKeyPem: string;
 try {
  authSecret = secretValue("ADT_RUNTIME_AUTH_SECRET");
 } catch {
  startup("runtime_startup_failed", "auth_secret_missing");
  process.exitCode = 1;
  return;
 }
 if (authSecret.length < 32) {
  startup("runtime_startup_failed", "auth_secret_invalid");
  process.exitCode = 1;
  return;
 }


 const optional = (name: string) => {
  try { return secretValue(name); } catch { return undefined; }
 };
 const redeploy: RedeployConfiguration = {
  runtime: optional("ADT_RUNTIME_REDEPLOY_WEBHOOK"),
  controller: optional("CODEX_RUNNER_CONTROLLER_REDEPLOY_WEBHOOK"),
  executor: optional("CODEX_RUNNER_EXECUTOR_REDEPLOY_WEBHOOK"),
  "repository-manager": optional("CODEX_RUNNER_REPOSITORY_MANAGER_REDEPLOY_WEBHOOK"),
 };
 const host = process.env.ADT_RUNTIME_HOST ?? "0.0.0.0";
 const port = Number(process.env.ADT_RUNTIME_PORT ?? 8080);
 if (!Number.isInteger(port) || port < 1 || port > 65535 || host.length > 255) {
  startup("runtime_startup_failed", "listen_configuration_invalid");
  process.exitCode = 1;
  return;
 }

 let database;
 try {
  database = readRuntimePostgresConfiguration();
 } catch (value) {
  startup("runtime_startup_failed", value instanceof Error && value.message==="postgres_configuration_missing" ? value.message : "postgres_configuration_invalid");
  process.exitCode = 1;
  return;
 }
 const pool = runtimePostgresPool(database.pool);
 let application:RuntimeApplication;
 try {
  const installation = await initializeRuntimeDatabase(pool, database.keyPath);
  privateKeyPem=await loadRuntimeWrappingPrivateKey(database.keyPath);
  const moduleUrl = new URL("./workflow-application.js",import.meta.url).href;
  const {createRuntimeApplication}=await import(moduleUrl) as {createRuntimeApplication:ApplicationFactory};
  application=createRuntimeApplication({
   pool,...installation,
   env:{...process.env,ADT_RUNTIME_BASE_URL:`http://127.0.0.1:${port}`,ADT_RUNTIME_AUTH_SECRET:authSecret,
    ADT_RUNTIME_WRAPPING_PUBLIC_KEY:createPublicKey(privateKeyPem).export({type:"spki",format:"pem"}).toString(),
    CODEX_RUNNER_ACCESS_CLIENT_ID:optional("CODEX_RUNNER_ACCESS_CLIENT_ID"),
    CODEX_RUNNER_ACCESS_CLIENT_SECRET:optional("CODEX_RUNNER_ACCESS_CLIENT_SECRET"),
    CODEX_RUNNER_SHARED_SECRET:optional("CODEX_RUNNER_SHARED_SECRET"),
   },
   onError:stage=>startup("workflow_progression_error",stage),
  });
 } catch (value) {
  startup("runtime_startup_failed",
   value instanceof RuntimeKeyError || value instanceof RuntimeDatabaseError ? value.code : "postgres_unavailable");
  await pool.end();
  process.exitCode = 1;
  return;
 }

 const revision = runtimeBuildRevision();
 let runtime;
 try {
  runtime = await createRuntimeServer({
   host, port, authSecret, privateKeyPem, revision, redeploy,
   ollamaAllowedBaseUrls: process.env.ADT_RUNTIME_OLLAMA_ALLOWED_BASE_URLS,
   control:application.store,
   operateSettings: operationalSettings(pool),
   recordManagementNonce: (nonce, timestamp) => recordManagementNonce(pool, nonce, timestamp),
   operationalDatabaseReady: async () => {
    const result = await pool.query("SELECT 1 FROM installation WHERE singleton");
    return result.rowCount === 1;
   },
  });
 } catch (value) {
  const knownStages = ["ollama_allowlist_invalid", "private_key_invalid", "wrapping_key_derivation_failed", "wrapping_key_import_failed"];
  startup("runtime_startup_failed", value instanceof Error && knownStages.includes(value.message) ? value.message : "runtime_configuration_invalid");
  await pool.end();
  process.exitCode = 1;
  return;
 }
 try {
  await runtime.listen();
 } catch {
  startup("runtime_startup_failed", "listen_failed");
  await pool.end();
  process.exitCode = 1;
  return;
 }
 application.start();
 process.stdout.write(`${JSON.stringify({event:"runtime_started",protocolVersion:PROTOCOL_VERSION,runtimeRevision:revision,port})}
`);
 const stop = () => {
  void (async()=>{
   await application.stop();
   runtime.shutdown();
   await runtime.close();
   await pool.end();
  })().catch(()=>{process.exitCode=1;});
  setTimeout(() => process.exit(1), 30_000).unref();

 };
 process.once("SIGTERM", stop);
 process.once("SIGINT", stop);
}
if(process.argv[1]===new URL(import.meta.url).pathname)void main();
