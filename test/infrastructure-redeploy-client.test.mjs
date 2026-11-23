import test from 'node:test';
import assert from 'node:assert/strict';
import {ADT_RUNTIME_PROTOCOL,ADT_RUNTIME_REDEPLOY_CAPABILITY,requestRuntimeRedeploy} from '../lib/adt-runtime-client.ts';
const config={baseUrl:'https://runtime.example',authSecret:'x'.repeat(40)};
const ready=targets=>({protocolVersion:ADT_RUNTIME_PROTOCOL,capabilities:[ADT_RUNTIME_REDEPLOY_CAPABILITY],redeployTargets:targets});

test('older and incompatible Runtime readiness fail safely before redeploy mutation',async()=>{for(const response of [{protocolVersion:ADT_RUNTIME_PROTOCOL,capabilities:[]},{...ready(['runtime']),protocolVersion:'adt-runtime-v2'}]){const calls=[],result=await requestRuntimeRedeploy(config,'runtime',async(url,init)=>{calls.push({url,init});return Response.json(response)});assert.equal(result.state,'unsupported');assert.equal(calls.length,1);assert.match(result.message,/manual Runtime update or configuration/);assert.doesNotMatch(JSON.stringify(result),/https:|secret/i)}});
test('target availability requires complete bounded Runtime readiness configuration',async()=>{for(const [target,targets,pattern] of [['runtime',[],/Runtime redeploy is not configured/],['runner',['runtime'],/Runner redeploy is not configured/]]){let calls=0;const result=await requestRuntimeRedeploy(config,target,async()=>{calls++;return Response.json(ready(targets))});assert.equal(result.state,'unsupported');assert.equal(calls,1);assert.match(result.message,pattern);assert.doesNotMatch(JSON.stringify(result),/webhook|https:|secret/i)}});
test('Runtime redeploy client sends only a configured fixed target and does not retry ambiguous dispatch',async()=>{const calls=[],result=await requestRuntimeRedeploy(config,'runner',async(url,init)=>{calls.push({url,init});if(calls.length===1)return Response.json(ready(['runtime','runner']));throw new TypeError('private network exception')});assert.equal(result.state,'ambiguous');assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[1].init.body),{target:'runner',requestId:JSON.parse(calls[1].init.body).requestId});assert.doesNotMatch(JSON.stringify(result),/private network exception|https:/)});
test('accepted Runtime response acknowledges the webhook request without claiming deployment completion',async()=>{for(const target of ['runtime','runner']){let calls=0;const result=await requestRuntimeRedeploy(config,target,async()=>++calls===1?Response.json(ready([target])):Response.json({protocolVersion:ADT_RUNTIME_PROTOCOL,ok:true,result:{state:'accepted',target}},{status:202}));assert.deepEqual(result,{state:'accepted',message:`${target==='runtime'?'Runtime':'Runner'} webhook request accepted. Checking update status.`});assert.equal(calls,2);assert.doesNotMatch(result.message,/confirmed|completed|successful/i)}});

test('rejected and ambiguous Runtime responses preserve semantics and discard upstream secrets',async()=>{
 const privateDetail='http://10.0.0.2/api/webhooks/private-token Authorization: Bearer private-credential';
 for(const ambiguous of [false,true]){
  let calls=0;
  const result=await requestRuntimeRedeploy(config,'runtime',async()=>++calls===1?Response.json(ready(['runtime'])):Response.json({protocolVersion:ADT_RUNTIME_PROTOCOL,ok:false,error:{ambiguous,safeMessage:privateDetail,outcomes:[{role:'runtime',outcome:ambiguous?'ambiguous':'rejected'}]}},{status:502}));
  assert.equal(result.state,ambiguous?'ambiguous':'rejected');
  assert.match(result.message,ambiguous?/outcome is uncertain/:/request rejected/);
  assert.equal(calls,2);
  assert.doesNotMatch(JSON.stringify(result),/10\.0\.0\.2|private-token|Authorization|private-credential/);
 }
});

test('self-redeployment timeout or lost response body remains uncertain without a second POST',async()=>{
 for(const failure of ['disconnect','timeout','body']){
  let posts=0;
  const result=await requestRuntimeRedeploy(config,'runtime',async(_url,init)=>{
   if(init.method==='GET')return Response.json(ready(['runtime']));
   posts++;
   if(failure==='timeout')throw new DOMException('private timeout detail','TimeoutError');
   if(failure==='disconnect')throw new TypeError('private connection detail');
   return new Response(new ReadableStream({start(controller){controller.error(new Error('private body detail'))}}),{status:202});
  });
  assert.equal(result.state,'ambiguous');
  assert.equal(posts,1);
  assert.match(result.message,/outcome is uncertain/);
  assert.doesNotMatch(JSON.stringify(result),/private/);
 }
});
