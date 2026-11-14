import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {installTsxHook} from './render-tsx.mjs';
const require=installTsxHook(),{AgentToolInspector}=require('../components/AgentToolInspector.tsx'),{AppRouterContext}=require('next/dist/shared/lib/app-router-context.shared-runtime');
test('approval UI submits opaque identities, keeps the decision identity after network loss, and displays exact call context',async t=>{
 const previous=globalThis.fetch,previousAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true;let tree,posts=0;const sent=[],runId=crypto.randomUUID(),approvalId=crypto.randomUUID(),view={operator:false,tools:[{id:'invocation',nodeId:'agent-node',providerCallId:'original-call',iteration:2,attempt:1,tool:'server / change',target:'https://tools.example',state:'waiting',agentState:'waiting',arguments:{repository:'safe'},createdAt:Date.now(),approval:{canDecide:true,canReject:true,id:approvalId,status:'pending',expiresAt:Date.now()+60000}}]};
 globalThis.fetch=async(_url,init)=>{if(init?.method==='POST'){sent.push(JSON.parse(init.body));if(++posts===1)throw Error('lost response');return Response.json({recorded:true})}return Response.json(view)};
 t.after(async()=>{await act(async()=>tree?.unmount());globalThis.fetch=previous;globalThis.IS_REACT_ACT_ENVIRONMENT=previousAct});
 await act(async()=>{tree=create(React.createElement(AppRouterContext.Provider,{value:{refresh(){},push(){},replace(){},prefetch(){},back(){},forward(){}}},React.createElement(AgentToolInspector,{runId})))});
 const approve=()=>tree.root.findAllByType('button').find(button=>button.children.join('')==='Approve exact call');assert.ok(approve());assert.match(JSON.stringify(tree.toJSON()),/original-call/);assert.match(JSON.stringify(tree.toJSON()),/server \/ change/);
 await act(async()=>{await approve().props.onClick()});await act(async()=>{await approve().props.onClick()});assert.equal(sent.length,2);assert.equal(sent[0].decisionId,sent[1].decisionId);assert.deepEqual(Object.keys(sent[0]).sort(),['action','approvalId','decision','decisionId']);assert.equal(sent[0].approvalId,approvalId);assert.equal(sent[0].decision,'approved');
});

test('operator UI binds reconciliation and retry identity to the displayed admission',async t=>{
 const previous={fetch:globalThis.fetch,FormData:globalThis.FormData,act:globalThis.IS_REACT_ACT_ENVIRONMENT};globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const sent=[],first=crypto.randomUUID(),second=crypto.randomUUID(),view={operator:true,tools:[{id:'invocation',admissionId:first,nodeId:'agent',tool:'probe',target:'https://tools.example',state:'unknown',agentState:'reconciliation',arguments:{nonce:'safe'},createdAt:Date.now()}]};let tree;
 globalThis.FormData=function(){return{get:key=>({decision:'success',basis:'Target audit verified',result:'verified'})[key]}};
 globalThis.fetch=async(_url,init)=>{if(init?.method==='POST'){sent.push(JSON.parse(init.body));if(sent.length===1)throw Error('lost decision response');return Response.json({recorded:true})}return Response.json(view)};
 t.after(async()=>{await act(async()=>tree?.unmount());globalThis.fetch=previous.fetch;globalThis.FormData=previous.FormData;globalThis.IS_REACT_ACT_ENVIRONMENT=previous.act});
 await act(async()=>{tree=create(React.createElement(AppRouterContext.Provider,{value:{refresh(){}}},React.createElement(AgentToolInspector,{runId:crypto.randomUUID()})))});
 const submit=()=>tree.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:{}});
 await act(async()=>submit());await act(async()=>submit());assert.equal(sent[0].admissionId,first);assert.equal(sent[0].decisionId,sent[1].decisionId);
 view.tools[0].admissionId=second;await act(async()=>submit());await act(async()=>submit());assert.equal(sent.at(-1).admissionId,second);assert.notEqual(sent.at(-1).decisionId,sent[0].decisionId);
 assert.equal(sent[0].result,'verified');assert.equal('arguments' in sent[0],false);
});

test('repository viewers can inspect pending approval without receiving actionable approval controls',async t=>{
 const previous=globalThis.fetch,previousAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true;let tree;
 globalThis.fetch=async()=>Response.json({operator:false,tools:[{id:'invocation',nodeId:'agent',tool:'probe',target:'https://tools.example',state:'waiting',agentState:'waiting',arguments:{nonce:'safe'},createdAt:Date.now(),approval:{id:crypto.randomUUID(),status:'pending',canDecide:false,expiresAt:Date.now()+60000}}]});
 t.after(async()=>{await act(async()=>tree?.unmount());globalThis.fetch=previous;globalThis.IS_REACT_ACT_ENVIRONMENT=previousAct});await act(async()=>{tree=create(React.createElement(AppRouterContext.Provider,{value:{refresh(){}}},React.createElement(AgentToolInspector,{runId:crypto.randomUUID()})))});
 assert.match(JSON.stringify(tree.toJSON()),/pending/);assert.equal(tree.root.findAllByType('button').length,0);
});


test('a reviewer can reject an invalidated pending call without receiving an approval control',async t=>{
 const previous=globalThis.fetch,previousAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true;let tree;const sent=[],approvalId=crypto.randomUUID();
 globalThis.fetch=async(_url,init)=>{if(init?.method==='POST'){sent.push(JSON.parse(init.body));return Response.json({recorded:true})}return Response.json({operator:false,tools:[{id:'invocation',nodeId:'agent',tool:'probe',target:'https://tools.example',state:'waiting',agentState:'waiting',arguments:{},createdAt:Date.now(),approval:{id:approvalId,status:'pending',canDecide:false,canReject:true,expiresAt:Date.now()+60000}}]})};
 t.after(async()=>{await act(async()=>tree?.unmount());globalThis.fetch=previous;globalThis.IS_REACT_ACT_ENVIRONMENT=previousAct});await act(async()=>{tree=create(React.createElement(AppRouterContext.Provider,{value:{refresh(){}}},React.createElement(AgentToolInspector,{runId:crypto.randomUUID()})))});
 const buttons=tree.root.findAllByType('button');assert.equal(buttons.length,1);assert.equal(buttons[0].children.join(''),'Reject call');await act(async()=>{await buttons[0].props.onClick()});assert.equal(sent[0].approvalId,approvalId);assert.equal(sent[0].decision,'rejected');
});
