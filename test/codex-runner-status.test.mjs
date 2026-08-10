import test from "node:test";
import assert from "node:assert/strict";
import {installTsxHook} from "./render-tsx.mjs";

const require=installTsxHook();
const {CodexRunnerClient}=require("../lib/codex-runner-client.ts");
const {getSafeCodexConnectionStatus}=require("../lib/codex-runner-status.ts");

const secrets=["access-client-id-sentinel","access-client-secret-sentinel","runner-shared-secret-sentinel","response-body-sentinel","thrown-error-sentinel"];
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

test("logs runner_unavailable without a sensitive raw fetch error",async()=>{
 const {status,log}=await probe(async()=>{throw new Error("thrown-error-sentinel")});
 assert.deepEqual(log,{event:"codex_runner_status_failed",stage:"capabilities",category:"runner_unavailable"});
 assert.deepEqual(status,{state:"unavailable",label:"Runner unavailable"});
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
