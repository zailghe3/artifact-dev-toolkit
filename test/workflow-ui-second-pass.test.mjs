import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {installTsxHook} from './render-tsx.mjs';
import {getOpenAIModelAgentCapabilities,validateOpenAIModelAgentOptions} from '../lib/openai-model-agent-capabilities.ts';
import {AGENT_MASTER_PROMPT_MAX_LENGTH} from '../lib/workflow-definitions.ts';
import {copiedWorkflowAgentPrompt,searchWorkflowAgentPrompts,workflowAgentPromptDescriptor,workflowAgentPromptKeyAction,workflowAgentPromptSelection} from '../lib/workflow-agent-prompts.ts';
import {defaultWorkflowRunSort,nextWorkflowRunSort,sortWorkflowRunRows,workflowRunColumns} from '../lib/workflow-run-table.ts';

const requireTsx=installTsxHook();
const {WorkflowRunsTable}=requireTsx('../components/WorkflowRunsTable.tsx');
const {WorkflowAgentPromptSelector}=requireTsx('../components/WorkflowAgentPromptSelector.tsx');

const artifact=(id,type,status,title,body=`body ${id}`)=>({id,type,status,title,description:'',tags:[],aliases:[],body,excerpt:`excerpt ${id}`,path:`artifacts/${id}.md`});

test('run table behavior exposes stable columns, newest-first default sorting, and sortable state transitions',()=>{
 assert.deepEqual(workflowRunColumns.map(column=>column.key),['workflowName','status','startedAt','completedAt','currentStepId']);
 const runs=[
  {id:'old',workflowName:'Older',status:'succeeded',createdAt:'2026-08-20T09:00:00.000Z',startedAt:'2026-08-20T09:01:00.000Z',completedAt:'2026-08-20T09:02:00.000Z'},
  {id:'new',workflowName:'Newer',status:'running',createdAt:'2026-08-21T09:00:00.000Z',startedAt:'2026-08-21T09:01:00.000Z',currentStepId:'step-2'},
 ];
 assert.deepEqual(sortWorkflowRunRows(runs,defaultWorkflowRunSort).map(run=>run.id),['new','old']);
 const ascending=nextWorkflowRunSort(defaultWorkflowRunSort,'startedAt');
 assert.equal(ascending.direction,'ascending');
 assert.deepEqual(sortWorkflowRunRows(runs,ascending).map(run=>run.id),['old','new']);
 assert.deepEqual(nextWorkflowRunSort(ascending,'workflowName'),{key:'workflowName',direction:'ascending'});
});

test('run table renders semantic sortable headers and run navigation from behavior state',()=>{
 const html=renderToStaticMarkup(React.createElement(WorkflowRunsTable,{runs:[{id:'run-1',workflowName:'Review',status:'queued',createdAt:'2026-08-21T09:00:00.000Z'}]}));
 assert.match(html,/<table\b/);
 assert.match(html,/aria-sort="descending"[^>]*><button[^>]*>Started/);
 assert.match(html,/href="\/workflows\/runs\/run-1"[^>]*>Review<\/a>/);
});

test('prompt catalogue filters types and archived entries, orders production first, bounds results, and returns metadata only',()=>{
 const results=searchWorkflowAgentPrompts([
  artifact('draft','prompt','draft','Draft'),artifact('prod','prompt','production','Production'),artifact('old','prompt','archived','Old'),artifact('template','template','production','Template'),artifact('agent','agent','draft','Agent'),artifact('snippet','snippet','draft','Snippet'),
 ],'');
 assert.deepEqual(results.map(x=>x.id),['prod','draft']);
 assert.equal('body' in results[0],false);
 assert.equal(searchWorkflowAgentPrompts(Array.from({length:20},(_,i)=>artifact(`p-${i}`,'prompt','draft',`Prompt ${i}`)),'').length,15);
});

test('prompt selection and copying preserve reference semantics without exposing invalid artifact content',()=>{
 assert.deepEqual(workflowAgentPromptSelection({id:'prompt-a'}),{source:'artifact',artifactId:'prompt-a'});
 assert.deepEqual(workflowAgentPromptSelection(undefined),{source:'custom',text:''});
 assert.deepEqual(copiedWorkflowAgentPrompt({artifact:artifact('prompt-a','prompt','production','Prompt','Act safely.')}),{source:'custom',text:'Act safely.'});
 assert.equal(copiedWorkflowAgentPrompt({artifact:artifact('template-a','template','production','Template')}),undefined);
 assert.equal(copiedWorkflowAgentPrompt({artifact:artifact('prompt-a','prompt','production','Prompt','x'.repeat(AGENT_MASTER_PROMPT_MAX_LENGTH+1))}),undefined);
});

test('archived prompt references remain describable even though archived prompts are excluded from new searches',()=>{
 const archived=artifact('old','prompt','archived','Old prompt');
 assert.deepEqual(workflowAgentPromptDescriptor(archived),{id:'old',title:'Old prompt',description:'',status:'archived',tags:[],excerpt:'excerpt old'});
 assert.deepEqual(searchWorkflowAgentPrompts([archived],''),[]);
 assert.equal(workflowAgentPromptDescriptor(artifact('not-prompt','template','production','Template')),undefined);
});

test('prompt keyboard actions are defined by interaction outcomes rather than component source',()=>{
 assert.deepEqual(workflowAgentPromptKeyAction('ArrowDown',0,3,true),{type:'move',index:1});
 assert.deepEqual(workflowAgentPromptKeyAction('ArrowDown',2,3,true),{type:'move',index:2});
 assert.deepEqual(workflowAgentPromptKeyAction('ArrowUp',1,3,true),{type:'move',index:0});
 assert.deepEqual(workflowAgentPromptKeyAction('Enter',1,3,true),{type:'choose',index:1});
 assert.equal(workflowAgentPromptKeyAction('Enter',1,3,false),undefined);
 assert.deepEqual(workflowAgentPromptKeyAction('Escape',1,3,true),{type:'close'});
});

test('prompt selector renders an accessible combobox and custom prompt editor without source inspection',()=>{
 const html=renderToStaticMarkup(React.createElement(WorkflowAgentPromptSelector,{prompt:{source:'custom',text:'Act.'},setPrompt(){}}));
 assert.match(html,/role="combobox"/);
 assert.match(html,/aria-controls=/);
 assert.match(html,/<textarea[^>]*name="masterPrompt"[^>]*required=""/);
});

test('OpenAI capabilities are exact and unknown models are conservative',()=>{
 assert.deepEqual(getOpenAIModelAgentCapabilities('unknown-model'),{});
 const known=getOpenAIModelAgentCapabilities('gpt-5.2');
 assert.deepEqual(known.reasoningEfforts,['none','low','medium','high','xhigh']);
 assert.equal(known.reasoningEfforts.includes('max'),false);
 assert.throws(()=>validateOpenAIModelAgentOptions('gpt-5',{reasoningEffort:'xhigh'}));
 assert.deepEqual(validateOpenAIModelAgentOptions('unknown-model',{}),{});
 assert.throws(()=>validateOpenAIModelAgentOptions('unknown-model',{verbosity:'high'}));
});
