import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
import Module from 'node:module';
import {installTsxHook} from './render-tsx.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const originalLoad=Module._load,navigations=[];
Module._load=function(request,parent,isMain){
 if(request==='next/navigation')return{useRouter:()=>({push:path=>navigations.push(path),refresh(){}})};
 if(request==='@xyflow/react')return{ReactFlow:props=>React.createElement('mock-flow',props),Background:()=>null,Controls:()=>null,Handle:()=>null,Position:{Left:'left',Right:'right'},addEdge:(edge,edges)=>[...edges,edge],applyEdgeChanges:(_changes,edges)=>edges,applyNodeChanges:(_changes,nodes)=>nodes};
 return originalLoad.call(this,request,parent,isMain);
};
const requireTsx=installTsxHook(),{WorkflowDefinitionEditor}=requireTsx('../components/WorkflowDefinitionEditor.tsx');
const agents=[{id:'available',name:'Available',adapter:'codex-runner',connectionKey:'private',environmentKey:'private-env',managedGit:true,publishEligible:true}],reusableWorkflows=[{id:'reusable',name:'Reusable',description:''}];
const transfer=(id='imported',agentId='available',workflowId='reusable')=>({format:'adt-workflow-transfer',version:1,definition:{schemaVersion:2,id,name:'Imported workflow',description:'Imported description',status:'draft',runInputTemplate:'Input template',exposableAsBlock:true,nodes:[{id:'start',blockType:'agent',blockVersion:2,config:{agentId,context:{publishOutput:true,includeRunInput:true,includeNodeOutputs:[]}}},{id:'call',blockType:'subworkflow',blockVersion:1,config:{workflowId}},{id:'finish',blockType:'agent',blockVersion:3,config:{agentId,context:{publishOutput:false,includeRunInput:false,includeNodeOutputs:['start']},conversation:{sourceNodeId:'start'}}},{id:'publish',blockType:'publish-github-pr',blockVersion:1,config:{sourceNodeId:'finish',title:'Exact title',body:'Exact body',draft:false}}],edges:[{id:'one',source:'start',target:'call'},{id:'two',source:'call',target:'finish'},{id:'three',source:'finish',target:'publish',targetPort:'managed-result'}],limits:{maxStepExecutions:64}},layout:{schemaVersion:1,workflowId:id,positions:{start:{x:123,y:45}},edgeWaypoints:{one:[{x:10,y:20}]},viewport:{x:-33,y:77,zoom:1.8}}});
const text=node=>node.findAll(item=>typeof item.type==='string').flatMap(item=>item.children).filter(item=>typeof item==='string').join(' ');
const button=(view,label)=>view.root.findAllByType('button').find(item=>text(item)===label);
const input=(view,name)=>view.root.findByProps({name});
const pasteField=view=>view.root.findAllByType('textarea').find(item=>!item.props.name&&!item.props.readOnly);
async function mount(extra={}){let view;await act(async()=>{view=create(React.createElement(WorkflowDefinitionEditor,{agents,reusableWorkflows,authoringContext:'{"safe":true}',...extra}))});return view}
async function paste(view,value){await act(async()=>pasteField(view).props.onChange({target:{value:JSON.stringify(value)}}))}
async function load(view,value){await paste(view,value);await act(async()=>button(view,'Load into editor').props.onClick())}
async function change(view,name,value){await act(async()=>input(view,name).props.onChange({target:{value}}))}

test('load is explicit, creates no request, hydrates layout/settings and Create uses existing endpoints with edited ID',async()=>{
 const prior=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,method:init.method,body:JSON.parse(init.body)});return Response.json({fileSha:'new-sha'})};let view;
 try{
  view=await mount();const payload=transfer();await paste(view,payload);assert.equal(input(view,'name').props.value,'');assert.equal(calls.length,0);
  await act(async()=>button(view,'Load into editor').props.onClick());assert.equal(calls.length,0);assert.equal(input(view,'id').props.value,'imported');assert.equal(input(view,'name').props.value,'Imported workflow');assert.equal(input(view,'description').props.value,'Imported description');assert.equal(input(view,'runInputTemplate').props.value,'Input template');
  const graph=view.root.findByType('mock-flow');assert.equal(graph.props.nodes.length,4);assert.equal(graph.props.edges.length,3);assert.deepEqual(graph.props.nodes[0].position,{x:123,y:45});assert.deepEqual(graph.props.edges[0].data.waypoints,[{x:10,y:20}]);assert.deepEqual(graph.props.viewport,payload.layout.viewport);assert.equal(graph.props.nodes[2].data.conversationSourceNodeId,'start');assert.deepEqual(graph.props.nodes[2].data.includeNodeOutputs,['start']);assert.equal(graph.props.nodes[3].data.draft,false);
  await change(view,'id','renamed');await change(view,'name','Edited workflow');assert.equal(input(view,'id').props.value,'renamed');
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.deepEqual(calls.map(call=>[call.url,call.method]),[['/api/workflow-definitions','POST'],['/api/workflow-definitions/renamed/layout','PUT']]);assert.equal(calls[0].body.id,'renamed');assert.equal(calls[0].body.name,'Edited workflow');assert.equal(calls[1].body.layout.workflowId,'renamed');assert.equal(calls[1].body.workflowFileSha,'new-sha');assert.deepEqual(calls[1].body.layout.edgeWaypoints,payload.layout.edgeWaypoints);assert.ok(navigations.includes('/workflows/definitions/renamed'));
 }finally{globalThis.fetch=prior;if(view)await act(async()=>view.unmount())}
});

test('meaningful manual work needs explicit replacement; cancellation and invalid input preserve it',async()=>{
 const view=await mount();try{
  await change(view,'name','Manual');await act(async()=>button(view,'Add Agent block').props.onClick());await load(view,transfer());assert.equal(input(view,'name').props.value,'Manual');assert.ok(button(view,'Replace unsaved draft'));
  await act(async()=>button(view,'Cancel').props.onClick());assert.equal(input(view,'name').props.value,'Manual');assert.equal(view.root.findByType('mock-flow').props.nodes.length,1);
  await load(view,transfer());await act(async()=>button(view,'Replace unsaved draft').props.onClick());assert.equal(input(view,'name').props.value,'Imported workflow');
  await load(view,{format:'wrong'});assert.equal(input(view,'name').props.value,'Imported workflow');assert.match(text(view.root),/Wrong format/);
 }finally{await act(async()=>view.unmount())}
});

test('missing references and collision remain visible, disable creation, and are repairable',async()=>{
 const prior=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({fileSha:'unused'})};const view=await mount({existingWorkflowIds:['imported']});try{
  await load(view,transfer('imported','unknown-agent','unknown-workflow'));assert.equal(button(view,'Create workflow').props.disabled,true);for(const fragment of ['Missing Agent: unknown-agent','Missing reusable Workflow: unknown-workflow','already exists'])assert.match(text(view.root),new RegExp(fragment));
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(calls,0);
  for(const select of view.root.findAllByType('select').filter(item=>item.props.value==='unknown-agent'))await act(async()=>select.props.onChange({target:{value:'available'}}));
  const missing=view.root.findAllByType('select').find(item=>item.props.value==='unknown-workflow');await act(async()=>missing.props.onChange({target:{value:'reusable'}}));
  assert.equal(button(view,'Create workflow').props.disabled,true);await change(view,'id','unique');assert.equal(button(view,'Create workflow').props.disabled,false);assert.equal(calls,0);
 }finally{globalThis.fetch=prior;await act(async()=>view.unmount())}
});

test('clipboard copy is explicit and failure offers manual context selection; persisted editor excludes text import',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');let copies=0;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{copies++;assert.equal(text,'{"safe":true}');throw new Error('PRIVATE FAILURE')}}}});let view;
 try{view=await mount();assert.equal(copies,0);await act(async()=>button(view,'Copy authoring context').props.onClick());assert.equal(copies,1);assert.match(text(view.root),/copy the text manually/);assert.doesNotMatch(text(view.root),/PRIVATE FAILURE/);assert.equal(view.root.findByProps({'aria-label':'Workflow Authoring Context'}).props.readOnly,true);await act(async()=>view.unmount());view=await mount({initial:transfer().definition,fileSha:'saved'});assert.equal(button(view,'Load into editor'),undefined);assert.equal(button(view,'Copy authoring context'),undefined)}finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;if(view)await act(async()=>view.unmount())}
});
