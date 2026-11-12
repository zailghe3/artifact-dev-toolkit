import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {installTsxHook} from './render-tsx.mjs';
const require=installTsxHook(),{AgentToolInspector}=require('../components/AgentToolInspector.tsx'),{AppRouterContext}=require('next/dist/shared/lib/app-router-context.shared-runtime');
test('approval UI submits opaque identities, keeps the decision identity after network loss, and displays exact call context',async t=>{
 const previous=globalThis.fetch,previousAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true;let tree,posts=0;const sent=[],runId=crypto.randomUUID(),approvalId=crypto.randomUUID(),view={operator:false,tools:[{id:'invocation',nodeId:'agent-node',providerCallId:'original-call',iteration:2,attempt:1,tool:'server / change',target:'https://tools.example',state:'waiting',agentState:'waiting',arguments:{repository:'safe'},createdAt:Date.now(),approval:{id:approvalId,status:'pending',expiresAt:Date.now()+60000}}]};
 globalThis.fetch=async(_url,init)=>{if(init?.method==='POST'){sent.push(JSON.parse(init.body));if(++posts===1)throw Error('lost response');return Response.json({recorded:true})}return Response.json(view)};
 t.after(async()=>{await act(async()=>tree?.unmount());globalThis.fetch=previous;globalThis.IS_REACT_ACT_ENVIRONMENT=previousAct});
 await act(async()=>{tree=create(React.createElement(AppRouterContext.Provider,{value:{refresh(){},push(){},replace(){},prefetch(){},back(){},forward(){}}},React.createElement(AgentToolInspector,{runId})))});
 const approve=()=>tree.root.findAllByType('button').find(button=>button.children.join('')==='Approve exact call');assert.ok(approve());assert.match(JSON.stringify(tree.toJSON()),/original-call/);assert.match(JSON.stringify(tree.toJSON()),/server \/ change/);
 await act(async()=>{await approve().props.onClick()});await act(async()=>{await approve().props.onClick()});assert.equal(sent.length,2);assert.equal(sent[0].decisionId,sent[1].decisionId);assert.deepEqual(Object.keys(sent[0]).sort(),['action','approvalId','decision','decisionId']);assert.equal(sent[0].approvalId,approvalId);assert.equal(sent[0].decision,'approved');
});
