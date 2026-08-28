import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSequentialWorkflow} from '../lib/workflow-definitions.ts';
import {defaultStepPosition,normalizeWorkflowLayout,projectSequentialWorkflow,workflowLayoutSchema} from '../lib/workflow-layout.ts';
import {GitHubWorkflowLayoutRepository,InMemoryWorkflowLayoutRepository} from '../lib/workflow-layout-repository.ts';

const agents=[{id:'agent-one',name:'Agent One'},{id:'agent-two',name:'Agent Two'},{id:'agent-three',name:'Agent Three'}];
const workflow=buildSequentialWorkflow({id:'visual-flow',name:'Visual flow',agents});
const layout=(positions={},viewport={x:12,y:-7,zoom:1.25})=>normalizeWorkflowLayout(workflow,positions,viewport);

test('sequential Workflow projects to one node per step and only derived ordered edges',()=>{
 const graph=projectSequentialWorkflow(workflow);
 assert.deepEqual(graph.nodes.map(node=>({id:node.id,agentId:node.data.agentId,stepNumber:node.data.stepNumber})),[
  {id:'step-1',agentId:'agent-one',stepNumber:1},{id:'step-2',agentId:'agent-two',stepNumber:2},{id:'step-3',agentId:'agent-three',stepNumber:3},
 ]);
 assert.deepEqual(graph.edges.map(edge=>[edge.source,edge.target]),[['step-1','step-2'],['step-2','step-3']]);
});

test('missing, stale, and partial layouts reconcile deterministically to current steps',()=>{
 const first=projectSequentialWorkflow(workflow),second=projectSequentialWorkflow(workflow);
 assert.deepEqual(first,second);assert.deepEqual(first.nodes.map(node=>node.position),[defaultStepPosition(0),defaultStepPosition(1),defaultStepPosition(2)]);
 const stale=workflowLayoutSchema.parse({schemaVersion:1,workflowId:workflow.id,positions:{'removed-step':{x:999,y:999},'step-2':{x:80,y:90}},viewport:{x:4,y:5,zoom:0.8}}),graph=projectSequentialWorkflow(workflow,stale);
 assert.deepEqual(graph.nodes.map(node=>node.id),['step-1','step-2','step-3']);assert.deepEqual(graph.nodes[1].position,{x:80,y:90});assert.deepEqual(graph.nodes[2].position,defaultStepPosition(2));assert.deepEqual(graph.viewport,stale.viewport);
 const normalized=normalizeWorkflowLayout(workflow,Object.fromEntries(graph.nodes.map(node=>[node.id,node.position])),graph.viewport);
 assert.deepEqual(Object.keys(normalized.positions),['step-1','step-2','step-3']);assert.equal('removed-step' in normalized.positions,false);
});

test('layout schema stores only identity, stable step positions, and viewport',()=>{
 const value=layout({'step-1':{x:20,y:30}});assert.deepEqual(Object.keys(value).sort(),['positions','schemaVersion','viewport','workflowId']);
 assert.throws(()=>workflowLayoutSchema.parse({...value,edges:[]}));assert.throws(()=>workflowLayoutSchema.parse({...value,positions:{'step-1':{x:1,y:2,agent:{secret:'no'}}}}));
});

test('in-memory layout creation and update are revision-aware and independent of Workflow semantics',async()=>{
 const repository=new InMemoryWorkflowLayoutRepository(),semantic=structuredClone(workflow),created=await repository.createLayout(layout({'step-1':{x:10,y:20}}));
 await assert.rejects(repository.createLayout(layout()),/changed/);await assert.rejects(repository.updateLayout(layout({'step-1':{x:30,y:40}}),'stale'),/changed/);
 assert.deepEqual((await repository.getLayout(workflow.id)).definition.positions['step-1'],{x:10,y:20});
 const updated=await repository.updateLayout(layout({'step-1':{x:30,y:40}}),created.fileSha);assert.deepEqual(updated.definition.positions['step-1'],{x:30,y:40});assert.deepEqual(workflow,semantic);assert.deepEqual(workflow.steps.map(step=>step.agentId),agents.map(agent=>agent.id));
});

test('Git layout access is confined to canonical path and stale writes never mutate',async()=>{
 const files=new Map(),mutations=[];let revision=0;
 const request=async(path,init={})=>{assert.match(path,/^\/contents\/workflows\/visual-flow\.layout\.json$/);const name=path.slice('/contents/'.length),method=init.method??'GET',old=files.get(name);if(method==='GET')return old?new Response(JSON.stringify(old),{status:200}):new Response('',{status:404});const body=JSON.parse(init.body);mutations.push({name,body});if((old&&body.sha!==old.sha)||(!old&&body.sha))return new Response('',{status:409});if(old&&!body.sha)return new Response('',{status:422});const stored={content:body.content,sha:`git-layout-${++revision}`};files.set(name,stored);return new Response(JSON.stringify({content:{sha:stored.sha}}),{status:200});};
 const repository=new GitHubWorkflowLayoutRepository(request),created=await repository.createLayout(layout({'step-1':{x:11,y:22}}));assert.equal(created.sourcePath,'workflows/visual-flow.layout.json');assert.equal(mutations[0].body.sha,undefined);
 files.set('workflows/visual-flow.layout.json',{...files.get('workflows/visual-flow.layout.json'),sha:'newer-revision'});const count=mutations.length;
 await assert.rejects(repository.updateLayout(layout({'step-1':{x:44,y:55}}),created.fileSha),/changed/);assert.equal(mutations.length,count);
 await assert.rejects(repository.getLayout('../escape'));assert.throws(()=>workflowLayoutSchema.parse({...layout(),workflowId:'other/workflow'}));
});

test('React Flow stays in the client editor and out of Workflow execution and adt-runtime',()=>{
 const editor=readFileSync('components/WorkflowLayoutEditor.tsx','utf8');assert.match(editor,/^"use client";/);assert.match(editor,/from "@xyflow\/react"/);
 for(const path of ['lib/workflow-durable-driver.ts','lib/workflow-launch.ts','lib/agent-runtime.ts','adt-runtime/src/server.ts'])assert.doesNotMatch(readFileSync(path,'utf8'),/@xyflow\/react|WorkflowLayoutEditor/);
});

test('layout API authorises before repository access and keeps responses private',()=>{
 const route=readFileSync('app/api/workflow-definitions/[id]/layout/route.ts','utf8'),auth=route.indexOf('requireApiRepositoryAccess(request)'),repository=route.indexOf('createWorkflowDefinitionRepository(auth.access)');
 assert.ok(auth>=0);assert.ok(repository>auth);assert.match(route,/auth instanceof Response\)return auth/);assert.match(route,/noStoreHeaders/);assert.match(route,/body\.layout\.workflowId!==id/);
});
