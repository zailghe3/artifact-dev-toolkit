import test from "node:test";
import assert from "node:assert/strict";
import {installTsxHook} from "./render-tsx.mjs";

const require=installTsxHook();
const {CodexRunnerClient,parseRunnerControlStatus}=require("../lib/codex-runner-client.ts");
const {getSafeCodexConnectionStatus}=require("../lib/codex-runner-status.ts");
const {runnerActionFailure}=require("../lib/codex-runner-actions.ts");
const {EXPECTED_RUNNER_RELEASE}=require("../lib/codex-runner-release.ts");

const secrets=["access-client-id-sentinel","access-client-secret-sentinel","runner-shared-secret-sentinel","response-body-sentinel","thrown-error-sentinel","redirect-location-sentinel"];
const configuration={baseUrl:"https://runner.example.test",accessClientId:secrets[0],accessClientSecret:secrets[1],sharedSecret:secrets[2],production:true};
const capabilities={protocolVersion:1,runnerRevision:EXPECTED_RUNNER_RELEASE.runnerRevision,runnerVersion:"a".repeat(40),codexVersion:"0.147.0",codexAvailable:true,deviceAuth:true,jobExecution:true};

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
 assert.deepEqual(status,{state:"connected",label:"Connected to ChatGPT",capabilities:{...capabilities,releaseMetadata:"current"},compatibility:{protocol:"compatible",runnerRevision:"current",codexVersion:"current"},auth:{connected:true,authMode:"chatgpt",planType:"plus"}});
});

test("legacy protocol-v1 capabilities remain compatible and usable during rollout",async()=>{
 const legacy={protocolVersion:1,runnerVersion:"b".repeat(40),codexAvailable:true,deviceAuth:true,jobExecution:true};let call=0;
 const client=new CodexRunnerClient(configuration,async()=>Response.json(++call===1?legacy:{connected:true,authMode:"chatgpt"}));
 assert.deepEqual(await client.capabilities(),{...legacy,releaseMetadata:"legacy"});call=0;
 const status=await getSafeCodexConnectionStatus({clientFactory:()=>client,logger:()=>{}});
 assert.equal(status.state,"connected");assert.equal(status.capabilities.releaseMetadata,"legacy");assert.deepEqual(status.compatibility,{protocol:"compatible",runnerRevision:"unknown",codexVersion:"unknown"});assert.equal(status.capabilities.jobExecution,true);
});

test("build provenance validation distinguishes production and development ADT",async()=>{
 const response=runnerVersion=>Response.json({...capabilities,runnerVersion});
 const make=(production,runnerVersion)=>new CodexRunnerClient({...configuration,production},async()=>response(runnerVersion));
 assert.equal((await make(true,"a".repeat(40)).capabilities()).runnerVersion,"a".repeat(40));
 await assert.rejects(make(true,"development").capabilities(),error=>error.category==="invalid_response");
 assert.equal((await make(false,"a".repeat(40)).capabilities()).runnerVersion,"a".repeat(40));
 assert.equal((await make(false,"development").capabilities()).runnerVersion,"development");
 await assert.rejects(make(false,"dev-build").capabilities(),error=>error.category==="invalid_response");
});

test("capabilities parser rejects malformed release metadata and unsupported protocol",async()=>{
 const client=value=>new CodexRunnerClient(configuration,async()=>Response.json(value));
 for(const value of [{...capabilities,runnerRevision:undefined},{...capabilities,runnerRevision:0},{...capabilities,runnerVersion:"abc123"},{...capabilities,codexVersion:"0.147"},{...capabilities,privateConfiguration:"secret"}])await assert.rejects(client(value).capabilities(),error=>error.category==="invalid_response");
 await assert.rejects(client({...capabilities,protocolVersion:2}).capabilities(),error=>error.category==="runner_update_required");
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

test("auth diagnostic proxy accepts only the operational bounded shape",async()=>{
 const diagnostic={runnerReachable:true,codexAppServerReady:true,codexVersion:"0.147.0",codexVersionMatchesExpected:true,codexNativeLibc:"glibc",codexAddressPolicyApplies:true,customCaSource:"none",systemCaBundlePresent:true,systemCaBundleReadable:true,systemCaBundleNonEmpty:true,httpProxyConfigured:false,httpsProxyConfigured:false,allProxyConfigured:false,noProxyConfigured:false,dnsResolution:"ok",ipv4Available:true,ipv6Available:false,systemResolverFirstFamily:"ipv4",runnerAddressPolicy:"ipv4_preferred",runnerAddressPolicyEffective:false,kernelIpv6Disabled:false,ipv4TcpConnectivity:"ok",ipv6TcpConnectivity:"unavailable",ipv4TlsConnectivity:"ok",ipv6TlsConnectivity:"unavailable",deviceAuthRoute:{responseReceived:true,status:405},codexHomeReadable:true,codexHomeWritable:true,summary:[]};let request;
 const client=new CodexRunnerClient(configuration,async(url,options)=>{request={url:String(url),options};return Response.json(diagnostic)});assert.deepEqual(await client.authEnvironmentDiagnostics(),diagnostic);assert.equal(new URL(request.url).pathname,"/v1/diagnostics/auth-environment");
 await assert.rejects(new CodexRunnerClient(configuration,async()=>Response.json({...diagnostic,rawOutput:"secret"})).authEnvironmentDiagnostics(),error=>error.category==="invalid_response");
});

test("Runner timeout remains short for device start while diagnostics has a bounded 40 second override",async()=>{
 const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../lib/codex-runner-client.ts",import.meta.url),"utf8"));
 assert.match(source,/DEFAULT_RUNNER_TIMEOUT_MS=8_000/);assert.match(source,/AUTH_DIAGNOSTICS_TIMEOUT_MS=40_000/);assert.match(source,/auth-environment\",\"GET\",AUTH_DIAGNOSTICS_TIMEOUT_MS/);assert.doesNotMatch(source,/auth\/device\/start\",\"POST\",AUTH_DIAGNOSTICS_TIMEOUT_MS/);
 const client=new CodexRunnerClient({...configuration,timeoutMs:5},async(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new Error("aborted")))));
 await assert.rejects(client.startDeviceAuth(),error=>error.category==="runner_unavailable"&&error.transport==="timeout");
});

test("diagnostics can outlive eight seconds but fail closed at forty seconds without real waiting",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});
 const delayed=new CodexRunnerClient(configuration,async()=>new Promise(resolve=>setTimeout(()=>resolve(Response.json({})),9_000)));
 const inside=delayed.authEnvironmentDiagnostics();t.mock.timers.tick(9_000);
 await assert.rejects(inside,error=>error.category==="invalid_response"&&error.transport===undefined);
 const bounded=new CodexRunnerClient(configuration,async(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new Error("aborted")))));
 const outside=bounded.authEnvironmentDiagnostics();t.mock.timers.tick(40_000);
 await assert.rejects(outside,error=>error.category==="runner_unavailable"&&error.transport==="timeout");
});

test("reduced diagnostics reject every non-finite or malformed field",async()=>{const valid={runnerReachable:true,codexAppServerReady:true,codexVersion:"0.147.0",codexVersionMatchesExpected:true,codexNativeLibc:"glibc",codexAddressPolicyApplies:true,customCaSource:"none",systemCaBundlePresent:true,systemCaBundleReadable:true,systemCaBundleNonEmpty:true,httpProxyConfigured:false,httpsProxyConfigured:false,allProxyConfigured:false,noProxyConfigured:false,dnsResolution:"ok",ipv4Available:true,ipv6Available:false,systemResolverFirstFamily:"ipv4",runnerAddressPolicy:"ipv4_preferred",runnerAddressPolicyEffective:false,kernelIpv6Disabled:false,ipv4TcpConnectivity:"ok",ipv6TcpConnectivity:"unavailable",ipv4TlsConnectivity:"ok",ipv6TlsConnectivity:"unavailable",deviceAuthRoute:{responseReceived:true,status:405},codexHomeReadable:true,codexHomeWritable:true,summary:[]};for(const patch of [{ipv4TlsConnectivity:"raw"},{ipv4TcpFailureReason:"raw"},{systemResolverFirstFamily:"raw"},{runnerAddressPolicy:"raw"},{codexNativeLibc:"raw"},{customCaSource:"raw"},{customCaFileReadable:true},{codexVersion:"0.147"},{summary:["ok",42]},{deviceAuthRoute:{responseReceived:true,status:99}},{deviceAuthRoute:{responseReceived:true,status:405,body:"secret"}},{systemCaBundlePresent:"yes"}])await assert.rejects(new CodexRunnerClient(configuration,async()=>Response.json({...valid,...patch})).authEnvironmentDiagnostics(),error=>error.category==="invalid_response")});
test("Test Codex client accepts only bounded exact shapes",async()=>{assert.deepEqual(await new CodexRunnerClient(configuration,async()=>Response.json({ok:false,reason:"test_in_progress"})).testCodex(),{ok:false,reason:"test_in_progress"});for(const value of [{ok:true,durationMs:1,output:"secret"},{ok:false,reason:"raw"},{ok:false,reason:"timeout",threadId:"secret"}])await assert.rejects(new CodexRunnerClient(configuration,async()=>Response.json(value)).testCodex(),error=>error.category==="invalid_response")});
test("operational job list client accepts only bounded exact safe summaries",async()=>{const id='a'.repeat(48),digest='b'.repeat(64),now='2026-08-18T00:00:00.000Z',valid={capacity:{maxActive:1,activeJobId:id},jobs:[{jobId:id,idempotencyDigest:digest,environmentKey:'dev',state:'running',createdAt:now,updatedAt:now}]};assert.deepEqual(await new CodexRunnerClient(configuration,async()=>Response.json(valid)).jobs(25),valid);for(const value of [{...valid,secret:'x'},{...valid,jobs:[{...valid.jobs[0],outputText:'private'}]},{...valid,jobs:Array(101).fill(valid.jobs[0])},{...valid,capacity:{maxActive:2,activeJobId:null}},{...valid,jobs:[{...valid.jobs[0],state:'unknown'}]}])await assert.rejects(new CodexRunnerClient(configuration,async()=>Response.json(value)).jobs(100),error=>error.category==='invalid_response')});
test("operational job list accepts a near-worst-case 100-record response within its dedicated bound",async()=>{const now='2026-08-18T00:00:00.000Z',jobs=Array.from({length:100},(_,index)=>({jobId:index.toString(16).padStart(48,'0'),idempotencyDigest:index.toString(16).padStart(64,'0'),environmentKey:'a'.repeat(80),state:'failed',reason:'interaction_required',createdAt:now,updatedAt:now})),body=JSON.stringify({capacity:{maxActive:1,activeJobId:null},jobs});assert.ok(Buffer.byteLength(body)>32768);assert.ok(Buffer.byteLength(body)<65536);assert.equal((await new CodexRunnerClient(configuration,async()=>new Response(body)).jobs(100)).jobs.length,100);await assert.rejects(new CodexRunnerClient(configuration,async()=>new Response(' '.repeat(65537))).jobs(100),error=>error.category==='invalid_response');await assert.rejects(new CodexRunnerClient(configuration,async()=>Response.json({capacity:{maxActive:1,activeJobId:null},jobs:[...jobs,jobs[0]]})).jobs(100),error=>error.category==='invalid_response')});
test('workspace diagnostics client accepts only the exact bounded safe shape',async()=>{const good={environmentKey:'artifact-dev-toolkit',filesystemReady:true,gitAvailable:true,gitRepository:true,headCommit:'a'.repeat(40),dirty:false};const client=new CodexRunnerClient(configuration,async()=>Response.json(good));assert.deepEqual(await client.workspaceDiagnostics('artifact-dev-toolkit'),good);for(const bad of [{...good,cwd:'/private'}, {...good,headCommit:'ABC'}, {...good,dirty:'clean'}, {...good,environmentKey:'other'}]){const invalid=new CodexRunnerClient(configuration,async()=>Response.json(bad));await assert.rejects(invalid.workspaceDiagnostics('artifact-dev-toolkit'),error=>error.category==='invalid_response')}});
test('sandbox diagnostics parser is strict, bounded, and supports an old Runner 404',async()=>{const good={environmentKey:'artifact-dev-toolkit',status:'unavailable',backend:'bubblewrap',reason:'user_namespace_unavailable'};assert.deepEqual(await new CodexRunnerClient(configuration,async()=>Response.json(good)).sandboxDiagnostics(good.environmentKey),good);assert.equal(await new CodexRunnerClient(configuration,async()=>Response.json({error:'not_found'},{status:404})).sandboxDiagnostics(good.environmentKey),null);for(const bad of [{...good,raw:'secret'},{...good,status:'broken'},{...good,backend:'private'},{...good,reason:'arbitrary diagnostic'},{...good,environmentKey:'Other Key'},{...good,status:'available'}])await assert.rejects(new CodexRunnerClient(configuration,async()=>Response.json(bad)).sandboxDiagnostics(good.environmentKey),error=>error.category==='invalid_response');await assert.rejects(new CodexRunnerClient(configuration,async()=>new Response('x'.repeat(1025))).sandboxDiagnostics(good.environmentKey),error=>error.category==='invalid_response')});
test('Workspace status renders advisory Git states and never calls unknown clean',()=>{const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{WorkspaceSection}=require('../components/CodexRunnerOperationalStatus.tsx'),environment={key:'artifact-dev-toolkit',name:'Artifact Dev Toolkit',enabled:true,ready:true,sandbox:'workspace-write'};const unavailable=renderToStaticMarkup(React.createElement(WorkspaceSection,{items:[{environment,diagnostics:null,sandboxDiagnostic:{state:"unsupported"}}]}));assert.match(unavailable,/require a newer Runner/);const diagnosticUnavailable=renderToStaticMarkup(React.createElement(WorkspaceSection,{items:[{environment,diagnostics:null,sandboxDiagnostic:{state:"unavailable"}}]}));assert.match(diagnosticUnavailable,/currently unavailable/);const nonGit=renderToStaticMarkup(React.createElement(WorkspaceSection,{items:[{environment,diagnostics:{environmentKey:environment.key,filesystemReady:true,gitAvailable:true,gitRepository:false,headCommit:null,dirty:null},sandboxDiagnostic:{state:"unavailable"}}]}));assert.match(nonGit,/Not a Git checkout/);assert.match(nonGit,/repository-aware operations are unavailable/);assert.match(nonGit,/State unavailable/);assert.doesNotMatch(nonGit,/>Clean</)});

test("control status parser is exact and enforces safe hard-restart combinations",()=>{const valid={emergencyStopped:true,stoppedGeneration:"generation-a",updatedAt:"2026-08-22T00:00:00.000Z",hardRestart:{attempted:true,succeeded:false,reason:"request_failed"},role:"controller",executor:{healthy:true,generation:"generation-b",activeExecutionId:null,activity:null,boundary:"container"}};assert.deepEqual(parseRunnerControlStatus(valid),valid);for(const bad of [{...valid,webhook:"secret"},{...valid,hardRestart:{attempted:true,succeeded:true,reason:"request_failed"}},{...valid,hardRestart:{attempted:false,succeeded:true}},{...valid,hardRestart:{attempted:true,succeeded:false,reason:"raw"}},{...valid,executor:{...valid.executor,privateState:"secret"}}])assert.throws(()=>parseRunnerControlStatus(bad),error=>error.category==="invalid_response")});
