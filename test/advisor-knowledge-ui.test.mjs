import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {installTsxHook} from './render-tsx.mjs';
import {document} from './support/knowledge-fixture.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.self=globalThis;
const requireTsx=installTsxHook(),{AdvisorKnowledge}=requireTsx('../components/AdvisorKnowledge.tsx'),{AdvisorSaveKnowledge}=requireTsx('../components/AdvisorSaveKnowledge.tsx'),{AppRouterContext}=requireTsx('next/dist/shared/lib/app-router-context.shared-runtime');
const text=v=>JSON.stringify(v.toJSON()),button=(v,label)=>v.root.findAllByType('button').find(b=>b.children.join('')===label);
const wrap=child=>React.createElement(AppRouterContext.Provider,{value:{push(path){navigation=path},refresh(){}}},child);let navigation;
test('save from an Advisor result creates only an editable unapproved proposal with stable source references',async()=>{
 const old=fetch;let calls=0,payload,view;globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'/api/advisor/knowledge/proposals');payload=JSON.parse(init.body);return Response.json({id:'proposal-id'})};
 try{await act(async()=>{view=create(wrap(React.createElement(AdvisorSaveKnowledge,{runId:'run-id',workflowId:'review',revision:'workflow-sha',output:'Hypothesis: repeated timeouts.'})))});await act(async()=>button(view,'Save to knowledge').props.onClick());assert.equal(calls,1);assert.equal(payload.expectedSha,null);assert.equal(payload.document.metadata.type,'finding');assert.equal(payload.document.metadata.status,'active');assert.deepEqual(payload.document.metadata.runIds,['run-id']);assert.match(payload.document.body,/Unreviewed/);assert.equal('approved' in payload,false);assert.equal(navigation,'/advisor/knowledge?proposal=proposal-id')}
 finally{if(view)await act(async()=>view.unmount());globalThis.fetch=old}
});
test('knowledge browsing/editing keeps review and each explicit publication separate and surfaces stale/uncertain states',async()=>{
 const old=fetch,p={id:'proposal-id',document:document(),expectedSha:null,revision:1,state:'draft',publication:null};let view,writes=0,reviewing=0,saves=0,fail=false;
 globalThis.fetch=async(url,init)=>{
  if(url==='/api/advisor/knowledge/proposals'&&!init?.body)return Response.json({proposals:[p]});
  const body=init?.body?JSON.parse(init.body):undefined;
  if(url==='/api/advisor/knowledge/proposals'){saves++;p.document=body.document;p.revision++;return Response.json(p)}
  if(body?.action==='review'){reviewing++;return Response.json({proposal:{...p,state:'reviewed'},reviewToken:'review-token'})}
  if(body?.action==='publish'){writes++;assert.equal(body.confirmation,'publish');if(fail){p.state='uncertain';return Response.json({error:'Publication outcome is uncertain. Inspect Git.'},{status:503})}p.state='published';return Response.json(p)}
  if(url.includes('?id='))return Response.json({...p.document,available:true,fileSha:'a'.repeat(40),revision:'b'.repeat(40),path:'advisor/knowledge/retry-policy.md',sourceUrl:'https://github.com/acme/private/blob/revision/advisor/knowledge/retry-policy.md'});
  return Response.json({results:[],nextOffset:null,invalidCount:0});
 };
 try{
  await act(async()=>{view=create(React.createElement(AdvisorKnowledge,{initialProposalId:p.id}))});assert.match(text(view),/Review and edit proposal/);assert.equal(button(view,'Approve and publish to Git'),undefined);
  const content=view.root.findAllByType('textarea').find(t=>t.props.maxLength===32768);await act(async()=>content.props.onChange({target:{value:'Reviewed evidence. No implementation has been verified.'}}));
  await act(async()=>button(view,'Save draft').props.onClick());assert.equal(saves,1);assert.equal(writes,0);assert.match(text(view),/not published/);
  await act(async()=>button(view,'Review publication').props.onClick());assert.equal(reviewing,1);assert.equal(writes,0);assert.equal(button(view,'Approve and publish to Git').props.disabled,true);
  const checkbox=view.root.findByProps({type:'checkbox'});await act(async()=>checkbox.props.onChange({target:{checked:true}}));assert.equal(button(view,'Approve and publish to Git').props.disabled,false);
  await act(async()=>button(view,'Approve and publish to Git').props.onClick());assert.equal(writes,1);assert.match(text(view),/Knowledge published to Git/);assert.equal(button(view,'Approve and publish to Git'),undefined);
  await act(async()=>button(view,'Open published knowledge').props.onClick());assert.match(text(view),/Prepare update/);await act(async()=>button(view,'Prepare update').props.onClick());await act(async()=>button(view,'Review publication').props.onClick());fail=true;await act(async()=>view.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));await act(async()=>button(view,'Approve and publish to Git').props.onClick());assert.match(text(view),/Publication outcome is uncertain/);assert.equal(view.root.findByType('fieldset').props.disabled,true);assert.equal(writes,2);
 }finally{if(view)await act(async()=>view.unmount());globalThis.fetch=old}
});
