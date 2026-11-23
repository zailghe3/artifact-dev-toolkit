import test from 'node:test';
import assert from 'node:assert/strict';
import {handleInfrastructureRedeploy} from '../lib/infrastructure-redeploy-action.ts';
import {ADT_RUNTIME_PROTOCOL,ADT_RUNTIME_REDEPLOY_CAPABILITY,requestRuntimeRedeploy} from '../lib/adt-runtime-client.ts';
const component=state=>({state,...(state==='unknown'?{unknownReason:'observation_unavailable'}:{})});
const snapshot=(target,state)=>({state:state==='superseded'?'superseded':state==='unknown'?'unknown':'current',checkedAt:new Date().toISOString(),components:{worker:component('current'),runtime:component(target==='runtime'?state:'current'),runner:component(target==='runner'?state:'current')}});
const request=(body={target:'runtime'},origin='https://adt.example')=>new Request('https://adt.example/api/infrastructure-redeploy',{method:'POST',headers:{origin,'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
const fixture=(overrides={})=>{const calls={authorize:0,freshness:0,redeploy:0,invalidate:0};return{calls,deps:{authorize:async()=>{calls.authorize++;return{}},freshness:async()=>{calls.freshness++;return snapshot('runtime','superseded')},redeploy:async target=>{calls.redeploy++;return{state:'accepted',message:`${target} requested`}},invalidate:()=>calls.invalidate++,...overrides}}};

test('authentication and current repository authorization complete before infrastructure probing',async()=>{for(const status of [401,403]){const f=fixture({authorize:async()=>{f.calls.authorize++;return Response.json({error:'denied'},{status})}}),response=await handleInfrastructureRedeploy(request(),f.deps);assert.equal(response.status,status);assert.deepEqual(f.calls,{authorize:1,freshness:0,redeploy:0,invalidate:0})}});
test('cross-origin and malformed or App targets fail before freshness or Runtime mutation',async()=>{for(const candidate of [[request({},'https://evil.example'),403],[request('{'),400],[request({target:'app'}),400]]){const f=fixture(),response=await handleInfrastructureRedeploy(candidate[0],f.deps);assert.equal(response.status,candidate[1]);assert.equal(f.calls.redeploy,0);assert.equal(f.calls.freshness,0)}});
test('current and unknown targets reject after a fresh eligibility observation without Runtime mutation',async()=>{for(const state of ['current','unknown']){const f=fixture({freshness:async()=>{f.calls.freshness++;return snapshot('runtime',state)}}),response=await handleInfrastructureRedeploy(request(),f.deps),body=await response.json();assert.equal(response.status,409);assert.equal(f.calls.freshness,1);assert.equal(f.calls.redeploy,0);assert.match(body.message,state==='unknown'?/could not be confirmed/:/not currently superseded/)}});
test('fresh superseded eligibility can dispatch and invalidate while ignoring any stale browser claim',async()=>{const f=fixture(),response=await handleInfrastructureRedeploy(request({target:'runtime',freshness:'current'}),f.deps);assert.equal(response.status,400);assert.equal(f.calls.redeploy,0);const accepted=await handleInfrastructureRedeploy(request({target:'runtime'}),f.deps);assert.equal(accepted.status,202);assert.deepEqual(f.calls,{authorize:2,freshness:1,redeploy:1,invalidate:1})});
test('older or unconfigured Runtime guidance remains bounded and secret-free',async()=>{for(const message of ['Runtime-mediated redeploy is unavailable; a manual Runtime update or configuration is required.','Runner redeploy is not configured. A manual update or Runtime configuration is required.']){const target=message.startsWith('Runner')?'runner':'runtime',f=fixture({freshness:async()=>{f.calls.freshness++;return snapshot(target,'superseded')},redeploy:async()=>{f.calls.redeploy++;return{state:'unsupported',message}}}),response=await handleInfrastructureRedeploy(request({target}),f.deps),text=await response.text();assert.equal(response.status,501);assert.match(text,/manual/i);assert.doesNotMatch(text,/https?:|webhook|secret|portainer/i)}});

test('Worker relays accepted, rejected, and lost Runtime acknowledgements safely without retrying',async()=>{
 for(const target of ['runtime','runner'])for(const state of ['accepted','rejected','ambiguous']){
  let posts=0;
  const config={baseUrl:'https://private-runtime.example',authSecret:'private-auth-secret'.repeat(3)},privateDetail='http://10.0.0.2/api/webhooks/private-token Authorization: Bearer private-credential';
  const f=fixture({freshness:async()=>snapshot(target,'superseded'),redeploy:async()=>requestRuntimeRedeploy(config,target,async(_url,init)=>{
   if(init.method==='GET')return Response.json({protocolVersion:ADT_RUNTIME_PROTOCOL,capabilities:[ADT_RUNTIME_REDEPLOY_CAPABILITY],redeployTargets:[target]});
   posts++;
   if(state==='ambiguous')throw new TypeError(privateDetail);
   return Response.json(state==='accepted'?{protocolVersion:ADT_RUNTIME_PROTOCOL,ok:true,result:{state:'accepted',target}}:{protocolVersion:ADT_RUNTIME_PROTOCOL,ok:false,error:{ambiguous:false,safeMessage:privateDetail}},{status:state==='accepted'?202:502});
  })});
  const response=await handleInfrastructureRedeploy(request({target}),f.deps),text=await response.text(),body=JSON.parse(text);
  assert.equal(response.status,state==='accepted'?202:state==='ambiguous'?502:503);
  assert.equal(body.state,state);
  assert.match(body.message,state==='accepted'?/webhook request accepted/:state==='ambiguous'?/outcome is uncertain/:/request rejected/);
  assert.equal(posts,1);
  assert.equal(f.calls.invalidate,state==='accepted'?1:0);
  assert.match(response.headers.get('cache-control'),/no-store/);
  for(const secret of [config.baseUrl,config.authSecret,'10.0.0.2','private-token','Authorization','private-credential'])assert.equal(text.includes(secret),false);
 }
});
