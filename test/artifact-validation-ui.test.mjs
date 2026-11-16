import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {installTsxHook} from './render-tsx.mjs';
const require=installTsxHook();
const {ArtifactValidationAction,ArtifactValidationProvider,OperationalHealthSummary,ArtifactDomainStatus}=require('../components/ArtifactValidationAction.tsx');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const deferred=()=>{let resolve;return{promise:new Promise(r=>{resolve=r}),resolve:value=>resolve(value)}};
const domains=[{key:'artifact-library',title:'Artifact Library',state:'healthy',checks:[{id:'artifact-validation',label:'Content validation',status:{label:'Not run',tone:'neutral'},contributes:false}]}];
const text=view=>JSON.stringify(view.toJSON());
test('validation prevents duplicates, completes, updates health, clears failure and permits rerun',async t=>{
 const old=global.fetch;t.after(()=>{global.fetch=old});const pending=deferred();let calls=0;
 global.fetch=async(url,init)=>{calls++;assert.equal(url,'/api/diagnostics/repository/validation');assert.equal(init.cache,'no-store');return pending.promise};
 let view;await act(async()=>{view=create(React.createElement(ArtifactValidationProvider,{initial:{state:'not_run'}},React.createElement(React.Fragment,null,React.createElement(OperationalHealthSummary,{domains}),React.createElement(ArtifactDomainStatus,{domain:domains[0]}),React.createElement(ArtifactValidationAction))))});t.after(()=>act(()=>view.unmount()));
 const button=()=>view.root.findByType('button');
 await act(async()=>{void button().props.onClick();void button().props.onClick()});assert.equal(calls,1);assert.equal(button().props.disabled,true);
 await act(async()=>{pending.resolve(Response.json({validation:{state:'invalid',validCount:16,invalidCount:1,errors:[{path:'prompts/a.md',code:'invalid_metadata',message:'Artifact metadata is invalid.'}]}}))});
 assert.equal(button().props.disabled,false);assert.match(text(view),/invalid/);assert.match(text(view),/Needs attention/);
 global.fetch=async()=>{throw new TypeError('private exception token')};
 await act(async()=>{await button().props.onClick()});assert.equal(button().props.disabled,false);assert.match(text(view),/temporarily unavailable/);assert.doesNotMatch(text(view),/private exception|token/);
 global.fetch=async()=>Response.json({validation:{state:'valid',validCount:17,invalidCount:0}});
 await act(async()=>{await button().props.onClick()});assert.equal(button().props.disabled,false);assert.doesNotMatch(text(view),/temporarily unavailable/);assert.match(text(view),/Healthy/);
});
test('stalled validation response body times out and button becomes actionable',async t=>{
 const old=global.fetch;t.after(()=>{global.fetch=old});let signal;
 global.fetch=async(_url,init)=>{signal=init.signal;return{ok:true,json:()=>new Promise(()=>{})}};
 t.mock.timers.enable({apis:['setTimeout']});let view;
 await act(async()=>{view=create(React.createElement(ArtifactValidationAction))});t.after(()=>act(()=>view.unmount()));
 await act(async()=>{void view.root.findByType('button').props.onClick()});
 await act(async()=>{t.mock.timers.tick(50_001)});
 assert.ok(signal.aborted);assert.equal(view.root.findByType('button').props.disabled,false);assert.match(text(view),/temporarily unavailable/);
});
test('unmount cancels in-flight validation',async t=>{
 const old=global.fetch;t.after(()=>{global.fetch=old});let signal;global.fetch=(_url,init)=>{signal=init.signal;return new Promise(()=>{})};let view;
 await act(async()=>{view=create(React.createElement(ArtifactValidationAction))});await act(async()=>{void view.root.findByType('button').props.onClick()});await act(async()=>view.unmount());assert.ok(signal.aborted);
});
test('dedicated validation route returns without querying slow Runtime or Runner services',async t=>{
 const Module=require('node:module'), originalLoad=Module._load;let runtimeCalls=0,runnerCalls=0;
 t.after(()=>{Module._load=originalLoad});
 Module._load=function(name,parent,isMain){
  if(name==='@/lib/auth')return{requireApiDiagnosticsAccess:async()=>({login:'allowed'})};
  if(name==='@/lib/repository-diagnostics')return{generateRepositoryDiagnostics:async(_session,options)=>{assert.equal(options.includeValidation,true);assert.ok(options.signal);return{validation:{state:'valid',validCount:17,invalidCount:0}}}};
  if(name==='@/lib/workflow-services')return{diagnoseADTRuntime:()=>{runtimeCalls++;return new Promise(()=>{})}};
  if(name==='@/lib/codex-runner-diagnostics')return{collectEssentialRunnerDiagnostics:()=>{runnerCalls++;return new Promise(()=>{})}};
  return originalLoad.call(this,name,parent,isMain);
 };
 const {GET}=require('../app/api/diagnostics/repository/validation/route.ts');
 const response=await GET(new Request('https://app.test/api/diagnostics/repository/validation'));
 assert.equal((await response.json()).validation.validCount,17);assert.equal(runtimeCalls,0);assert.equal(runnerCalls,0);
});
const {VariationForm}=require('../components/VariationForm.tsx');
const {ArtifactEditor}=require('../components/ArtifactEditor.tsx');
const nodeText=node=>node.findAll(()=>true).flatMap(item=>item.children).filter(child=>typeof child==='string').join(' ');
for(const [label,Component,props] of [['Save variation',VariationForm,{artifactId:'source',defaultBody:'Body',defaultTitle:'Source'}],['Create artifact',ArtifactEditor,{}]])for(const failure of ['uncertain','transport','invalid_success'])test(`${label} blocks repeated mutations after ${failure} until reconciliation`,async t=>{
 const old=global.fetch;t.after(()=>{global.fetch=old});let calls=0;
 global.fetch=async()=>{calls++;if(failure==='transport')throw new TypeError('private detail');return Response.json(failure==='uncertain'?{code:'mutation_uncertain'}:{},{status:failure==='uncertain'?503:201})};
 let view;await act(async()=>{view=create(React.createElement(Component,props))});t.after(()=>act(()=>view.unmount()));
 const button=()=>view.root.findAllByType('button').find(item=>nodeText(item).includes(label));
 await act(async()=>{await button().props.onClick()});assert.equal(button().props.disabled,true);assert.match(text(view),/may have saved/);assert.ok(view.root.findAllByType('a').some(link=>link.props.href==='/'));
 await act(async()=>{await button().props.onClick()});assert.equal(calls,1);
});
