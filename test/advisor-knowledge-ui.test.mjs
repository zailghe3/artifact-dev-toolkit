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
 try{await act(async()=>{view=create(wrap(React.createElement(AdvisorSaveKnowledge,{runId:'run-id',advisorWorkflowId:'advisor',advisorWorkflowRevision:'advisor-workflow-sha',output:'Hypothesis: repeated timeouts.'})))});await act(async()=>button(view,'Save to knowledge').props.onClick());assert.equal(calls,1);assert.equal(payload.expectedSha,null);assert.equal(payload.document.metadata.type,'finding');assert.equal(payload.document.metadata.status,'active');assert.deepEqual(payload.document.metadata.runIds,['run-id']);assert.deepEqual(payload.document.metadata.workflowIds,[]);assert.deepEqual(payload.document.metadata.agentIds,[]);assert.equal(payload.document.metadata.title,'Advisor investigation finding');assert.deepEqual(payload.document.metadata.evidence,[{source:'advisor-run:run-id:workflow:advisor',revision:'advisor-workflow-sha'}]);assert.match(payload.document.body,/Unreviewed/);assert.equal('approved' in payload,false);assert.equal(navigation,'/advisor/knowledge?proposal=proposal-id')}
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

test('Advisor Workflow A investigating B preserves A only as provenance; edited B subjects drive Git knowledge search',async t=>{
 const {database,context}=await import('./support/advisor-fixtures.mjs'),{KnowledgeProposalStore}=await import('../lib/advisor-knowledge-proposals.ts'),{knowledgeFixture}=await import('./support/knowledge-fixture.mjs');
 const db=await database(t),store=new KnowledgeProposalStore(db,context,{githubId:123,login:'reviewer',sessionId:'browser'}),git=knowledgeFixture(),runId=crypto.randomUUID();let proposal,saveView,editor,initialList,publishes=0;const previous=fetch,pendingRequests=new Set();
 async function settle(action){await act(async()=>{action();for(;;){await Promise.all([...pendingRequests]);await new Promise(resolve=>setImmediate(resolve));if(!pendingRequests.size)break}})}
 const dispatch=async(url,init)=>{
  const body=init?.body?JSON.parse(init.body):undefined;
  if(url==='/api/advisor/knowledge/proposals'&&!body){const values=initialList??await store.list();initialList=undefined;return Response.json({proposals:values})}
  if(url==='/api/advisor/knowledge/proposals'){proposal=await store.save(body);return Response.json(proposal)}
  if(body?.action==='review')return Response.json(await store.review(proposal.id,body.revision));
  if(body?.action==='publish'){publishes++;return Response.json(await store.publish(proposal.id,body.revision,body.reviewToken,(doc,sha,actor)=>git.repository.publish(doc,sha,actor)))}
  assert.fail('Unexpected request');
 };
 globalThis.fetch=(...args)=>{const promise=dispatch(...args);pendingRequests.add(promise);promise.finally(()=>pendingRequests.delete(promise));return promise};
 try{
  await act(async()=>{saveView=create(wrap(React.createElement(AdvisorSaveKnowledge,{runId,advisorWorkflowId:'advisor-a',advisorWorkflowRevision:'advisor-a-revision',output:'Workflow B needs review. Model also mentions workflow-c; neither mention establishes subject authority.'})))});
  await act(async()=>button(saveView,'Save to knowledge').props.onClick());assert.deepEqual(proposal.document.metadata.workflowIds,[]);assert.deepEqual(proposal.document.metadata.agentIds,[]);assert.deepEqual(proposal.document.metadata.runIds,[runId]);assert.deepEqual(proposal.document.metadata.evidence,[{source:`advisor-run:${runId}:workflow:advisor-a`,revision:'advisor-a-revision'}]);assert.equal(proposal.document.metadata.title,'Advisor investigation finding');assert.equal(git.writes.length,0);
  initialList=await store.list();
  await act(async()=>{editor=create(React.createElement(AdvisorKnowledge,{initialProposalId:proposal.id}))});
  assert.equal(editor.root.findAllByType('fieldset').length,1,'Persisted proposal loads for subject review');
  const field=prefix=>editor.root.findAllByType('label').find(label=>label.children.some(child=>typeof child==='string'&&child.startsWith(prefix))).findByType('input');
  await act(async()=>field('Investigated Workflow IDs').props.onChange({target:{value:'workflow-b'}}));
  await act(async()=>field('Investigated Agent IDs').props.onChange({target:{value:'agent-b'}}));
  await settle(()=>button(editor,'Review publication').props.onClick());assert.equal(git.writes.length,0);assert.equal(publishes,0);
  await act(async()=>editor.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));await settle(()=>button(editor,'Approve and publish to Git').props.onClick());assert.equal(publishes,1);assert.equal(git.writes.length,1);
  const actual=(await git.repository.search({workflowId:'workflow-b',agentId:'agent-b'})).results;assert.equal(actual.length,1);assert.deepEqual(actual[0].metadata.workflowIds,['workflow-b']);assert.deepEqual(actual[0].metadata.agentIds,['agent-b']);assert.deepEqual(actual[0].metadata.runIds,[runId]);assert.equal(actual[0].metadata.evidence[0].revision,'advisor-a-revision');
  for(const filter of [{workflowId:'advisor-a'},{workflowId:'workflow-c'},{agentId:'advisor-agent'}])assert.deepEqual((await git.repository.search(filter)).results,[]);
 }finally{if(saveView)await act(async()=>saveView.unmount());if(editor)await act(async()=>editor.unmount());globalThis.fetch=previous}
});
