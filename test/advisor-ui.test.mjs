import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {installTsxHook} from './render-tsx.mjs';
import {run} from './support/advisor-fixtures.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.self=globalThis;
const requireTsx=installTsxHook(),{AdvisorQuestion}=requireTsx('../components/AdvisorQuestion.tsx'),{AdvisorSettingsForm}=requireTsx('../components/AdvisorSettingsForm.tsx'),{AppRouterContext}=requireTsx('next/dist/shared/lib/app-router-context.shared-runtime');
const router={refresh(){},push(){},back(){},forward(){},replace(){},prefetch(){}},wrap=child=>React.createElement(AppRouterContext.Provider,{value:router},child);
const text=node=>JSON.stringify(node.toJSON()),deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};

test('Advisor has explicit unconfigured, starting, result and execution-error states',async()=>{
 const oldFetch=globalThis.fetch,OldFormData=globalThis.FormData;globalThis.FormData=class{get(){return 'Analyse review'}};
 const gate=deferred(),value=run();let requests=0,launches=0;globalThis.fetch=async url=>{requests++;if(url==='/api/advisor/runs'){launches++;return gate.promise}return Response.json({run:{...value,status:'succeeded',finalOutput:'Grounded analysis using review revision'},attempts:[]})};
 let view;try{
  await act(async()=>{view=create(wrap(React.createElement(AdvisorQuestion,{configured:false})))});assert.equal(view.root.findByType('textarea').props.disabled,true);
  await act(async()=>view.update(wrap(React.createElement(AdvisorQuestion,{configured:true}))));assert.equal(view.root.findByType('textarea').props.disabled,false);
  const form=()=>view.root.findByType('form');await act(async()=>{void form().props.onSubmit({preventDefault(){},currentTarget:{}})});assert.equal(view.root.findAllByType('button')[0].props['aria-busy'],true);assert.match(text(view),/Starting analysis/);
  await act(async()=>{void form().props.onSubmit({preventDefault(){},currentTarget:{}})});assert.equal(launches,1);
  await act(async()=>{gate.resolve(Response.json({runId:value.id}));await gate.promise});assert.match(text(view),/Grounded analysis/);assert.equal(view.root.findAllByType('a').find(a=>a.props.href===`/workflows/runs/${value.id}`).children.join(''),'Inspect execution');assert.equal(view.root.findByType('textarea').props.disabled,false);
  globalThis.fetch=async()=>Response.json({error:'Provider unavailable'},{status:503});await act(async()=>{await form().props.onSubmit({preventDefault(){},currentTarget:{}})});assert.match(text(view),/Provider unavailable/);assert.ok(requests>=2);
 }finally{if(view)await act(async()=>view.unmount());globalThis.fetch=oldFetch;globalThis.FormData=OldFormData}
});
test('Advisor settings save server configuration, reject stale updates and show pending state',async()=>{
 const old=globalThis.fetch,gate=deferred();let payload;globalThis.fetch=async(url,init)=>{assert.equal(url,'/api/advisor/settings');payload=JSON.parse(init.body);return gate.promise};let view;
 try{
  await act(async()=>{view=create(wrap(React.createElement(AdvisorSettingsForm,{initial:{settings:{workflowId:'review',override:null},revision:2},workflows:[{id:'review',name:'Review'}],connections:[{key:'agents',name:'Agents',model:'gpt-5',enabled:true}]})))});
  await act(async()=>view.root.findAllByType('select')[1].props.onChange({target:{value:'agents'}}));assert.equal(view.root.findByType('input').props.value,'gpt-5');
  await act(async()=>{void view.root.findByType('form').props.onSubmit({preventDefault(){}})});assert.equal(view.root.findByType('button').props['aria-busy'],true);assert.deepEqual(payload,{settings:{workflowId:'review',override:{connectionKey:'agents',model:'gpt-5'}},revision:2});
  await act(async()=>{gate.resolve(Response.json({settings:payload.settings,revision:3}));await gate.promise});assert.match(text(view),/Advisor settings saved/);
  globalThis.fetch=async()=>Response.json({error:'Advisor settings changed. Refresh before saving again.'},{status:409});await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.match(text(view),/Refresh before saving/);assert.equal(view.root.findByType('button').props.disabled,false);
 }finally{if(view)await act(async()=>view.unmount());globalThis.fetch=old}
});
