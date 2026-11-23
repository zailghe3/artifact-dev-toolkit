import test from 'node:test';
import assert from 'node:assert/strict';
import {redeployAvailable,requestRedeploy,validRedeployUrl} from '../dist/redeploy.js';

const configured={runtime:'http://portainer.local/runtime',executor:'http://portainer.local/executor','repository-manager':'http://portainer.local/repository',controller:'http://portainer.local/controller'};
test('redeploy URLs admit private HTTP(S), but reject malformed, userinfo, and oversized values',()=>{assert.equal(validRedeployUrl('http://10.0.0.2/hook'),true);assert.equal(validRedeployUrl('https://portainer.local/hook'),true);for(const value of [undefined,'ftp://portainer/hook','https://user:pass@portainer/hook','not a URL',`https://host/${'x'.repeat(2048)}`])assert.equal(validRedeployUrl(value),false);assert.equal(redeployAvailable('runtime',configured),true);assert.equal(redeployAvailable('runner',{...configured,controller:undefined}),false)});
test('Runtime dispatches once with manual redirects and bounds results without response bodies',async()=>{const calls=[],result=await requestRedeploy('runtime',configured,async(url,init)=>{calls.push({url,init});return new Response('private portainer body',{status:200})});assert.equal(result.accepted,true);assert.equal(calls.length,1);assert.equal(calls[0].init.redirect,'manual');assert.deepEqual(result.outcomes.map(({role,outcome,httpStatus})=>({role,outcome,httpStatus})),[{role:'runtime',outcome:'accepted',httpStatus:200}]);assert.doesNotMatch(JSON.stringify(result),/portainer|private/) });
test('Runner orders roles and only reaches Controller after prior acceptance',async()=>{const calls=[],result=await requestRedeploy('runner',configured,async url=>{calls.push(url);return new Response(null,{status:202})});assert.equal(result.accepted,true);assert.deepEqual(calls,[configured.executor,configured['repository-manager'],configured.controller])});
test('Executor rejection stops all later Runner dispatch and repository failure stops Controller',async()=>{for(const failureAt of [0,1]){const calls=[],result=await requestRedeploy('runner',configured,async url=>{calls.push(url);return new Response(null,{status:calls.length-1===failureAt?500:202})});assert.equal(result.accepted,false);assert.equal(calls.length,failureAt+1);assert.equal(calls.includes(configured.controller),false)}});
test('network and timeout-shaped failures remain ambiguous and are not retried',async()=>{for(const failure of [new TypeError('self-redeployment disconnected'),new DOMException('timed out','TimeoutError')]){let calls=0;const result=await requestRedeploy('runtime',configured,async()=>{calls++;throw failure});assert.equal(calls,1);assert.equal(result.accepted,false);assert.equal(result.ambiguous,true);assert.equal(result.outcomes[0].outcome,'ambiguous');assert.doesNotMatch(JSON.stringify(result),/timed out|self-redeployment/)}});
test('redirect responses are rejected and never followed by Runtime mechanics',async()=>{let calls=0;const result=await requestRedeploy('runtime',configured,async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response(null,{status:302})});assert.equal(calls,1);assert.equal(result.accepted,false);assert.equal(result.outcomes[0].outcome,'rejected')});

test('dispatch notification precedes each fetch, including while acknowledgement is pending',async()=>{
 for(const target of ['runtime','runner']){
  const roles=target==='runtime'?['runtime']:['executor','repository-manager','controller'],events=[];
  let acknowledge,started;
  const fetchStarted=new Promise(resolve=>{started=resolve});
  const pending=requestRedeploy(target,configured,(url)=>{
   const role=roles[events.filter(event=>event.startsWith('fetch:')).length];
   assert.equal(url,configured[role]);
   assert.equal(events.at(-1),`dispatch:${role}`);
   events.push(`fetch:${role}`);
   if(role===roles[0])return new Promise(resolve=>{acknowledge=resolve;started()});
   return Promise.resolve(new Response(null,{status:204}));
  },Date.now,role=>events.push(`dispatch:${role}`));
  await fetchStarted;
  assert.deepEqual(events,[`dispatch:${roles[0]}`,`fetch:${roles[0]}`]);
  acknowledge(new Response(null,{status:204}));
  assert.equal((await pending).accepted,true);
  assert.deepEqual(events,roles.flatMap(role=>[`dispatch:${role}`,`fetch:${role}`]));
 }
});

test('Runner ambiguity stops at the attempted role without retry or later dispatch notification',async()=>{
 for(const failureAt of [0,1,2]){
  const roles=['executor','repository-manager','controller'],dispatches=[],calls=[];
  const result=await requestRedeploy('runner',configured,async url=>{
   calls.push(url);
   if(calls.length-1===failureAt)throw new TypeError('private transport detail');
   return new Response(null,{status:202});
  },Date.now,role=>dispatches.push(role));
  assert.equal(result.accepted,false);
  assert.equal(result.ambiguous,true);
  assert.deepEqual(dispatches,roles.slice(0,failureAt+1));
  assert.deepEqual(calls,dispatches.map(role=>configured[role]));
  assert.deepEqual(result.outcomes.map(value=>value.outcome),[...Array(failureAt).fill('accepted'),'ambiguous']);
 }
});
