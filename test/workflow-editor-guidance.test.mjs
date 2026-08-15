import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

import {installTsxHook} from './render-tsx.mjs';
import {definitionIdDraftReducer, definitionIdFromName} from '../lib/definition-id.ts';

const requireTsx=installTsxHook();
const {AppRouterContext}=requireTsx('next/dist/shared/lib/app-router-context.shared-runtime');
const {WorkflowAgentEditor}=requireTsx('../components/WorkflowAgentEditor.tsx');
const {WorkflowDefinitionEditor}=requireTsx('../components/WorkflowDefinitionEditor.tsx');
const router={back(){},forward(){},refresh(){},push(){},replace(){},prefetch(){}};
const render=(component)=>renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:router},component));
const connection={key:'deterministic-test',name:'Deterministic test',adapter:'deterministic-test',enabled:true};
const agent={id:'planning-agent',name:'Planning Agent'};

test('shared definition ID generation is normalized, bounded, and schema-compatible',()=>{
 assert.equal(definitionIdFromName('Todo List Planner'),'todo-list-planner');
 assert.equal(definitionIdFromName('Security & Review Agent'),'security-review-agent');
 assert.equal(definitionIdFromName('  Planning / Review -- V2 '),'planning-review-v2');
 assert.equal(definitionIdFromName('Agent @#$% Test'),'agent-test');
 assert.equal(definitionIdFromName(' /\\.. "?\u0000 # % & '),'');
 assert.equal(definitionIdFromName('Feature Implementation Workflow'),'feature-implementation-workflow');
 assert.equal(definitionIdFromName('  Review & Plan / V2  '),'review-plan-v2');
 assert.equal(definitionIdFromName('Café Über'),'caf-ber');
 const long=definitionIdFromName(`${'a'.repeat(79)} & more`);
 assert.ok(long.length<=80);assert.match(long,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test('shared ID draft behavior follows names until a manual override',()=>{
 for(const name of ['Security Agent','Feature Implementation Workflow']){
  let draft={name:'',id:'',idOverridden:false};
  draft=definitionIdDraftReducer(draft,{type:'name',value:name});
  assert.equal(draft.id,definitionIdFromName(name));
  draft=definitionIdDraftReducer(draft,{type:'id',value:'my-reviewer'});
  draft=definitionIdDraftReducer(draft,{type:'name',value:'Different Name'});
  assert.equal(draft.id,'my-reviewer');
 }
});

test('Agent create and edit forms render explicit, accessible requirements',()=>{
 const create=render(React.createElement(WorkflowAgentEditor,{connections:[connection]}));
 for(const label of ['Name *','ID *','Description (optional)','Prompt *','Master prompt *','Connection *'])assert.ok(create.includes(label),label);
 assert.match(create,/<input(?=[^>]*name="name")(?=[^>]*required="")/);assert.match(create,/<input(?=[^>]*name="id")(?=[^>]*required="")/);
 assert.match(create,/<textarea(?=[^>]*name="masterPrompt")(?=[^>]*required="")/);assert.match(create,/<select(?=[^>]*name="connectionKey")(?=[^>]*required="")/);
 assert.match(create,/aria-describedby="agent-id-help"/);assert.match(create,/Permanent identifier used by Workflows/);
 const edit=render(React.createElement(WorkflowAgentEditor,{connections:[connection],initial:{id:'existing-agent',name:'Existing Agent',description:'',masterPrompt:'Act.',connectionKey:'deterministic-test'}}));
 assert.match(edit,/<input(?=[^>]*name="id")(?=[^>]*required="")(?=[^>]*readOnly="")(?=[^>]*value="existing-agent")/);
});

test('Workflow create and edit forms explain the required sequential Agent steps',()=>{
 const create=render(React.createElement(WorkflowDefinitionEditor,{agents:[agent]}));
 for(const label of ['Name *','ID *','Description (optional)','Ordered Agents *','Agent *'])assert.ok(create.includes(label),label);
 assert.match(create,/<input(?=[^>]*name="name")(?=[^>]*required="")/);assert.match(create,/<input(?=[^>]*name="id")(?=[^>]*required="")/);
 assert.match(create,/<select(?=[^>]*name="agent-0")(?=[^>]*required="")/);assert.match(create,/At least one Agent is required/);
 assert.match(create,/Step 1/);assert.match(create,/Receives the initial Workflow request/);
 const edit=render(React.createElement(WorkflowDefinitionEditor,{agents:[agent],initial:{id:'existing-workflow',name:'Existing Workflow',description:'',steps:[{agentId:agent.id}]}}));
 assert.match(edit,/<input(?=[^>]*name="id")(?=[^>]*required="")(?=[^>]*readOnly="")(?=[^>]*value="existing-workflow")/);
});

test('Workflow submenu displays Workflows at the unchanged definitions route',async()=>{
 const layout=await readFile(new URL('../components/WorkflowSubnav.tsx',import.meta.url),'utf8');
 assert.match(layout,/label:"Workflows",href:"\/workflows\/definitions"/);
 assert.doesNotMatch(layout,/label:"Definitions",href:"\/workflows\/definitions"/);
});

test('Codex Runner settings render only safe live selections in provider order',()=>{const codex={key:'codex-primary',name:'Codex',adapter:'codex-runner',enabled:true,capabilities:{asynchronous:true,cancellation:true}},catalog={environments:[{key:'safe-env',name:'Safe environment',enabled:true,ready:true,sandbox:'workspace-write'}],models:[{id:'model-a',displayName:'Model A',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'high',description:'First'},{reasoningEffort:'low',description:'Second'}]}]},html=render(React.createElement(WorkflowAgentEditor,{connections:[codex],codexCatalog:catalog}));assert.match(html,/<select(?=[^>]*name="environmentKey")(?=[^>]*required="")/);assert.doesNotMatch(html,/<input[^>]*name="environmentKey"/);assert.match(html,/Codex default/);assert.ok(html.indexOf('high — First')<html.indexOf('low — Second'));assert.doesNotMatch(html,/cwd|CODEX_RUNNER_SHARED_SECRET|runner-secret/)});
test('saved Codex values remain explicit when authentication catalog is unavailable',()=>{const codex={key:'codex-primary',name:'Codex',adapter:'codex-runner',enabled:true,capabilities:{asynchronous:true,cancellation:true}},html=render(React.createElement(WorkflowAgentEditor,{connections:[codex],initial:{id:'saved',name:'Saved',description:'',masterPrompt:'Act.',connectionKey:'codex-primary',adapterOptions:{environmentKey:'old-env',model:'old-model',reasoningEffort:'old-effort'}}}));for(const value of ['old-env (saved; live validation unavailable)','old-model (saved; live validation unavailable)','Codex model catalog unavailable'])assert.ok(html.includes(value),value)});
