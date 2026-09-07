import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {installTsxHook} from './render-tsx.mjs';
import {workflowLayoutSchema,normalizeWorkflowLayout,placeNodeInViewport,workflowExecutionLimitFromDraft} from '../lib/workflow-layout.ts';
import {agentExecutionTimeoutSeconds,openAIAgentsOptionsSchema} from '../lib/workflow-adapter.ts';
import {runtimeTransportTimeoutMs} from '../lib/adt-runtime-client.ts';
const workflow={schemaVersion:2,id:'route',name:'Route',description:'',status:'draft',nodes:[{id:'a',blockType:'agent',blockVersion:1,config:{agentId:'agent'}},{id:'b',blockType:'agent',blockVersion:1,config:{agentId:'agent'}}],edges:[{id:'a-b',source:'a',target:'b'}],limits:{maxStepExecutions:2}};
test('empty execution limit drafts normalize only the empty case',()=>{assert.equal(workflowExecutionLimitFromDraft(''),1);assert.equal(workflowExecutionLimitFromDraft(1),1);assert.equal(workflowExecutionLimitFromDraft(47),47);assert.equal(workflowExecutionLimitFromDraft(0),0);assert.equal(workflowExecutionLimitFromDraft(129),129)});
test('layout waypoints are bounded, finite, backward compatible, and stale routes are removed',()=>{
 assert.deepEqual(workflowLayoutSchema.parse({schemaVersion:1,workflowId:'route',positions:{},viewport:{x:0,y:0,zoom:1}}).edgeWaypoints,undefined);
 const layout=normalizeWorkflowLayout(workflow,{a:{x:0,y:0},b:{x:10,y:10}},{x:0,y:0,zoom:1},{'a-b':[{x:5,y:-20}],stale:[{x:1,y:1}]});
 assert.deepEqual(layout.edgeWaypoints,{'a-b':[{x:5,y:-20}]});
 assert.throws(()=>workflowLayoutSchema.parse({...layout,edgeWaypoints:{'a-b':[{x:Infinity,y:0}]}}));
 assert.throws(()=>workflowLayoutSchema.parse({...layout,edgeWaypoints:{'a-b':Array.from({length:9},()=>({x:0,y:0}))}}));
});
test('viewport placement accounts for pan and zoom and offsets repeated additions',()=>{
 const first=placeNodeInViewport({x:-400,y:-200,zoom:2},{width:800,height:600},[],{x:0,y:0});
 assert.deepEqual(first,{x:312,y:210});
 const second=placeNodeInViewport({x:-400,y:-200,zoom:2},{width:800,height:600},[first],{x:0,y:0});
 assert.notDeepEqual(second,first);
 assert.deepEqual(placeNodeInViewport({x:0,y:0,zoom:1},{width:0,height:0},[],{x:7,y:9}),{x:7,y:9});
});
test('Agent execution timeout validates bounds/default and derives transport allowance',()=>{
 assert.equal(agentExecutionTimeoutSeconds({}),30);assert.equal(agentExecutionTimeoutSeconds({executionTimeoutSeconds:5}),5);assert.equal(agentExecutionTimeoutSeconds({executionTimeoutSeconds:120}),120);
 for(const value of [4,121,5.5])assert.throws(()=>openAIAgentsOptionsSchema.parse({executionTimeoutSeconds:value}));
 assert.equal(runtimeTransportTimeoutMs(30),36000);assert.equal(runtimeTransportTimeoutMs(120),126000);
});

const requireTsx=installTsxHook(),{PendingButtonContent}=requireTsx('../components/PendingButtonContent.tsx'),{WorkflowWaypointEdge}=requireTsx('../components/WorkflowWaypointEdge.tsx'),{ReactFlowProvider}=requireTsx('@xyflow/react');
test('shared pending content is accessible and condition labels survive custom waypoint rendering',()=>{const pending=renderToStaticMarkup(React.createElement(PendingButtonContent,{pending:true},'Saving…'));assert.match(pending,/aria-hidden="true"/);assert.match(pending,/Saving…/);const edge=renderToStaticMarkup(React.createElement(ReactFlowProvider,null,React.createElement(WorkflowWaypointEdge,{id:'condition-true',source:'condition',target:'yes',sourceX:0,sourceY:0,targetX:100,targetY:50,sourcePosition:'right',targetPosition:'left',label:'true',data:{waypoints:[{x:50,y:10}],editable:false}})));assert.match(edge,/<text[^>]*>true<\/text>/)});

test('frozen runs and recovered attempts retain the launch timeout while new runs use edited Agent configuration',async()=>{const {newLangGraphWorkflowRun}=await import('../lib/workflow-storage.ts'),{durableInvocation}=await import('../lib/workflow-durable-driver.ts');const workflow={schemaVersion:2,id:'timeout-flow',name:'Timeout',description:'',status:'draft',nodes:[{id:'node',blockType:'agent',blockVersion:1,config:{agentId:'agent'}}],edges:[],limits:{maxStepExecutions:1}},plan={planVersion:2,nodes:workflow.nodes,edges:[],entryNodeId:'node',terminalNodeId:'node',maxStepExecutions:1},connection={key:'openai',name:'OpenAI',adapter:'openai-agents',defaultModel:'gpt-5',enabled:true,capabilities:{asynchronous:false,cancellation:false}},agent=seconds=>({schemaVersion:2,id:'agent',name:'Agent',description:'',status:'draft',prompt:{source:'custom',text:'Act.'},masterPrompt:'Act.',connectionKey:'openai',adapterOptions:{executionTimeoutSeconds:seconds}}),oldRun=newLangGraphWorkflowRun({id:'old-run',workflow,executionPlan:plan,revision:'workflow-sha',agents:[agent(30)],connections:[connection],initialInput:'input'}),edited=agent(120),newRun=newLangGraphWorkflowRun({id:'new-run',workflow,executionPlan:plan,revision:'workflow-sha',agents:[edited],connections:[connection],initialInput:'input'}),attempt={runId:'old-run',stepId:'node',iteration:2,attempt:3,agentId:'agent',connectionKey:'openai',status:'pending',providerPollCount:0,inputText:'retry'};const resolved={...connection,credential:'secret'};const recovered=await durableInvocation({run:oldRun,attempts:[attempt]},attempt,async()=>resolved);assert.equal(recovered.providerOptions.executionTimeoutSeconds,30);assert.equal(oldRun.agentSnapshots.agent.adapterOptions.executionTimeoutSeconds,30);assert.equal(newRun.agentSnapshots.agent.adapterOptions.executionTimeoutSeconds,120)});
