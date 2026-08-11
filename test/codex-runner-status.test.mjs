import test from "node:test";
import assert from "node:assert/strict";
import {installTsxHook} from "./render-tsx.mjs";

const require=installTsxHook();
const {CodexRunnerClient}=require("../lib/codex-runner-client.ts");
const {getSafeCodexConnectionStatus}=require("../lib/codex-runner-status.ts");
const {runnerActionFailure}=require("../lib/codex-runner-actions.ts");

const secrets=["access-client-id-sentinel","access-client-secret-sentinel","runner-shared-secret-sentinel","response-body-sentinel","thrown-error-sentinel","redirect-location-sentinel"];
const configuration={baseUrl:"https://runner.example.test",accessClientId:secrets[0],accessClientSecret:secrets[1],sharedSecret:secrets[2],production:true};
const capabilities={protocolVersion:1,runnerVersion:"1.2.3",codexAvailable:true,deviceAuth:true,jobExecution:true};

async function probe(fetcher){
 const logs=[];
 const status=await getSafeCodexConnectionStatus({clientFactory:()=>new CodexRunnerClient(configuration,fetcher),logger:value=>logs.push(value)});
 assert.equal(logs.length,1);
 const serialized=logs[0];
 for(const secret of secrets)assert.doesNotMatch(serialized,new RegExp(secret));
 return{status,log:JSON.parse(serialized)};
}

test("logs a safe capabilities-stage category for Cloudflare Access rejection",async()=>{
 const {status,log}=await probe(async()=>new Response("response-body-sentinel",{status:403,headers:{"cf-ray":"ray-id"}}));
 assert.deepEqual(log,{event:"codex_runner_status_failed",stage:"capabilities",category:"access_denied"});
 assert.deepEqual(status,{state:"unavailable",label:"Runner unavailable"});
});

test("logs a safe auth-stage category for Runner shared-secret rejection",async()=>{
 let call=0;
 const {status,log}=await probe(async()=>++call===1?Response.json(capabilities):new Response("response-body-sentinel",{status:401}));
 assert.deepEqual(log,{event:"codex_runner_status_failed",stage:"auth_status",category:"runner_unauthorized"});
 assert.deepEqual(status,{state:"unavailable",label:"Runner unavailable"});
 assert.equal(call,2);
});

test("logs a safe fetch transport reason without a sensitive raw fetch error",async()=>{
 const {status,log}=await probe(async()=>{throw new Error("thrown-error-sentinel")});
 assert.deepEqual(log,{event:"codex_runner_status_failed",stage:"capabilities",category:"runner_unavailable",transport:"fetch_error"});
 assert.deepEqual(status,{state:"unavailable",label:"Runner unavailable"});
});

test("logs a safe timeout transport reason",async()=>{
 const timeoutConfiguration={...configuration,timeoutMs:1};
 const logs=[];
 const fetcher=async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener("abort",()=>reject(new Error("thrown-error-sentinel")),{once:true}));
 const status=await getSafeCodexConnectionStatus({clientFactory:()=>new CodexRunnerClient(timeoutConfiguration,fetcher),logger:value=>logs.push(value)});
 assert.deepEqual(JSON.parse(logs[0]),{event:"codex_runner_status_failed",stage:"capabilities",category:"runner_unavailable",transport:"timeout"});
 assert.deepEqual(status,{state:"unavailable",label:"Runner unavailable"});
 for(const secret of secrets)assert.doesNotMatch(logs[0],new RegExp(secret));
});

for(const statusCode of [301,302,303,307,308])test(`does not follow or expose a Cloudflare Access ${statusCode} redirect`,async()=>{
 let calls=0;
 const {status,log}=await probe(async(_url,options)=>{
  calls++;
  assert.equal(options.redirect,"manual");
  return new Response("response-body-sentinel",{status:statusCode,headers:{"cf-ray":"ray-id",location:"https://redirect-location-sentinel.example.test"}});
 });
 assert.equal(calls,1);
 assert.deepEqual(log,{event:"codex_runner_status_failed",stage:"capabilities",category:"access_denied"});
 assert.deepEqual(status,{state:"unavailable",label:"Runner unavailable"});
});

test("classifies cf-access-domain redirect metadata as Access denial",async()=>{
 const {log}=await probe(async()=>new Response(null,{status:302,headers:{"cf-access-domain":"access.example.test"}}));
 assert.equal(log.category,"access_denied");
});

test("rejects an unexpected redirect as an invalid response",async()=>{
 const {status,log}=await probe(async()=>new Response("response-body-sentinel",{status:302,headers:{location:"https://redirect-location-sentinel.example.test"}}));
 assert.deepEqual(log,{event:"codex_runner_status_failed",stage:"capabilities",category:"invalid_response"});
 assert.deepEqual(status,{state:"unavailable",label:"Runner unavailable"});
});

test("preserves successful capabilities and auth status behavior",async()=>{
 let call=0;
 const logs=[];
 const status=await getSafeCodexConnectionStatus({clientFactory:()=>new CodexRunnerClient(configuration,async(_url,options)=>{assert.equal(options.redirect,"manual");return ++call===1?Response.json(capabilities):Response.json({connected:true,authMode:"chatgpt",planType:"plus"})}),logger:value=>logs.push(value)});
 assert.equal(call,2);
 assert.deepEqual(logs,[]);
 assert.deepEqual(status,{state:"connected",label:"Connected to ChatGPT",capabilities,auth:{connected:true,authMode:"chatgpt",planType:"plus"}});
});

test("logs invalid_response without including the malformed response body",async()=>{
 const {status,log}=await probe(async()=>new Response("response-body-sentinel",{status:200}));
 assert.deepEqual(log,{event:"codex_runner_status_failed",stage:"capabilities",category:"invalid_response"});
 assert.deepEqual(status,{state:"unavailable",label:"Runner unavailable"});
});

test("preserves an invalid response category during auth_status",async()=>{
 let call=0;
 const {status,log}=await probe(async()=>++call===1?Response.json(capabilities):Response.json({connected:"response-body-sentinel"}));
 assert.deepEqual(log,{event:"codex_runner_status_failed",stage:"auth_status",category:"invalid_response"});
 assert.deepEqual(status,{state:"unavailable",label:"Runner unavailable"});
});

test("logs configuration failures while preserving the safe missing state",async()=>{
 const logs=[];
 const status=await getSafeCodexConnectionStatus({clientFactory:()=>{throw new (require("../lib/codex-runner-client.ts").CodexRunnerError)("configuration_missing")},logger:value=>logs.push(value)});
 assert.deepEqual(JSON.parse(logs[0]),{event:"codex_runner_status_failed",stage:"configuration",category:"configuration_missing"});
 assert.deepEqual(status,{state:"configuration-missing",label:"Runner configuration missing"});
});

test("device proxy preserves only an allowlisted bounded Runner failure",async()=>{
 const client=new CodexRunnerClient(configuration,async()=>Response.json({error:"device_auth_start_failed",deviceAuthReason:"device_auth_rate_limited",upstreamHttpStatus:429,jsonRpcCode:-32000,accessToken:"response-body-sentinel"},{status:503}));
 let error;try{await client.startDeviceAuth()}catch(caught){error=caught}
 const logs=[];assert.deepEqual(runnerActionFailure("device_auth_start",error,value=>logs.push(value)),{error:"runner_unavailable",runnerCode:"device_auth_start_failed",deviceAuthReason:"device_auth_rate_limited",upstreamHttpStatus:429,jsonRpcCode:-32000});
 assert.deepEqual(JSON.parse(logs[0]),{event:"codex_runner_action_failed",stage:"device_auth_start",category:"runner_unavailable",runnerCode:"device_auth_start_failed",deviceAuthReason:"device_auth_rate_limited",upstreamHttpStatus:429,jsonRpcCode:-32000});
 for(const secret of secrets)assert.doesNotMatch(logs[0],new RegExp(secret));
});

test("device proxy rejects unallowlisted diagnostic fields",async()=>{const client=new CodexRunnerClient(configuration,async()=>Response.json({error:"device_auth_start_failed",deviceAuthReason:"response-body-sentinel",upstreamHttpStatus:"403 response-body-sentinel",jsonRpcCode:1.5,url:"https://response-body-sentinel.invalid"},{status:503}));let error;try{await client.startDeviceAuth()}catch(caught){error=caught}const logs=[];assert.deepEqual(runnerActionFailure("device_auth_start",error,value=>logs.push(value)),{error:"runner_unavailable",runnerCode:"device_auth_start_failed"});assert.doesNotMatch(logs[0],/response-body-sentinel|url|403/)});

test("unknown, malformed, and oversized Runner failures remain generic",async()=>{
 for(const response of [new Response("response-body-sentinel",{status:503}),Response.json({error:"arbitrary_remote_code"},{status:503}),new Response("x".repeat(32_769),{status:503})]){
  const client=new CodexRunnerClient(configuration,async()=>response);await assert.rejects(client.logout(),error=>error.category==="runner_unavailable"&&error.runnerCode===undefined);
 }
});

test("successful device proxy accepts only the OpenAI ceremony URL",async()=>{
 const ceremony={loginId:"login",verificationUrl:"https://auth.openai.com/device",userCode:"SAFE-CODE"};
 assert.deepEqual(await new CodexRunnerClient(configuration,async()=>Response.json(ceremony)).startDeviceAuth(),ceremony);
 await assert.rejects(new CodexRunnerClient(configuration,async()=>Response.json({...ceremony,verificationUrl:"https://redirect-location-sentinel.example"})).startDeviceAuth(),error=>error.category==="invalid_response");
});

test("auth diagnostic proxy uses the fixed Runner route and validates only bounded fields",async()=>{
 const diagnostic={runnerReachable:true,codexAppServerReady:true,customCaSource:"codex_ca_certificate",customCaFileReadable:false,httpProxyConfigured:true,httpsProxyConfigured:false,allProxyConfigured:false,noProxyConfigured:true,dnsResolution:"ok",ipv4Available:true,ipv6Available:false,tcpConnectivity:"timeout",codexHomeReadable:true,codexHomeWritable:false};let request;
 const client=new CodexRunnerClient(configuration,async(url,options)=>{request={url:String(url),options};return Response.json({...diagnostic,proxyUrl:"https://response-body-sentinel.invalid",resolvedAddress:"response-body-sentinel"})});
 assert.deepEqual(await client.authEnvironmentDiagnostics(),diagnostic);
 assert.equal(new URL(request.url).pathname,"/v1/diagnostics/auth-environment");assert.equal(request.options.method,"GET");assert.equal(request.options.redirect,"manual");
});

test("auth diagnostic proxy rejects malformed and oversized Runner responses",async()=>{
 const valid={runnerReachable:true,codexAppServerReady:true,customCaSource:"none",httpProxyConfigured:false,httpsProxyConfigured:false,allProxyConfigured:false,noProxyConfigured:false,dnsResolution:"ok",ipv4Available:true,ipv6Available:false,tcpConnectivity:"ok",codexHomeReadable:true,codexHomeWritable:true};
 for(const value of [{...valid,customCaSource:"/secret/ca"},{...valid,customCaFileReadable:true},{...valid,dnsResolution:"192.0.2.1"},{...valid,tcpConnectivity:"socket-error-sentinel"}])await assert.rejects(new CodexRunnerClient(configuration,async()=>Response.json(value)).authEnvironmentDiagnostics(),error=>error.category==="invalid_response");
 await assert.rejects(new CodexRunnerClient(configuration,async()=>new Response("x".repeat(32_769))).authEnvironmentDiagnostics(),error=>error.category==="invalid_response");
});
