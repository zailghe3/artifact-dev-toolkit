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

const codexConnection={key:'codex-primary',name:'Codex',adapter:'codex-runner',enabled:false,capabilities:{asynchronous:true,cancellation:true}};
const snapshot=(overrides={})=>({configured:true,reachable:true,capabilitiesAvailable:true,codexAvailable:true,jobExecution:true,environmentCatalogAvailable:true,authenticated:true,authStatusAvailable:true,modelCatalogAvailable:true,available:true,environments:[{key:'dev',name:'Development',enabled:true,ready:true,sandbox:'workspace-write'},{key:'offline',name:'Offline',enabled:true,ready:false,sandbox:'read-only'}],models:[{id:'model-a',displayName:'Model A',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'high',description:'First'},{reasoningEffort:'low',description:'Second'}]}],...overrides});
test('Codex remains a selectable connection when it is not executable',()=>{const html=render(React.createElement(WorkflowAgentEditor,{connections:[connection,codexConnection],codexSnapshot:snapshot({available:false,authenticated:false,modelCatalogAvailable:false,models:[]})}));assert.match(html,/<option value="codex-primary">Codex \(Configuration available\)<\/option>/);assert.doesNotMatch(html,/<option value="codex-primary" disabled/)});
test('Codex Runner settings expose ready and unavailable Runner environments',()=>{const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:{id:'saved',name:'Saved',description:'',masterPrompt:'Act.',connectionKey:'codex-primary',adapterOptions:{environmentKey:'dev'}},codexSnapshot:snapshot()}));assert.match(html,/Additional settings/);assert.match(html,/<select(?=[^>]*name="environmentKey")(?=[^>]*required="")/);assert.match(html,/<option value="dev" selected="">Development \/ dev<\/option>/);assert.match(html,/<option value="offline" disabled="">Offline \/ offline \(Unavailable\)<\/option>/);assert.match(html,/Codex default/);assert.ok(html.indexOf('high — First')<html.indexOf('low — Second'));assert.doesNotMatch(html,/cwd|CODEX_RUNNER_SHARED_SECRET|runner-secret/)});
test('Codex unavailable capability blocks save without preventing selection',()=>{const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:{id:'saved',name:'Saved',description:'',masterPrompt:'Act.',connectionKey:'codex-primary',adapterOptions:{environmentKey:'dev'}},codexSnapshot:snapshot({available:false,codexAvailable:false})}));assert.match(html,/Codex is unavailable on this Runner/);assert.match(html,/<button disabled=""[^>]*>Save Agent<\/button>/);assert.doesNotMatch(html,/<option value="codex-primary" disabled/)});
test('failed capability discovery retains environments without claiming jobs are unsupported',()=>{const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:{id:'saved',name:'Saved',description:'',masterPrompt:'Act.',connectionKey:'codex-primary',adapterOptions:{environmentKey:'dev'}},codexSnapshot:snapshot({available:false,capabilitiesAvailable:false,codexAvailable:false,jobExecution:false})}));assert.match(html,/Development \/ dev/);assert.match(html,/Codex Runner capabilities are unavailable/);assert.doesNotMatch(html,/does not support Workflow job execution/);assert.match(html,/<button disabled=""[^>]*>Save Agent<\/button>/)});
test('advertised missing job execution capability blocks save specifically',()=>{const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:{id:'saved',name:'Saved',description:'',masterPrompt:'Act.',connectionKey:'codex-primary',adapterOptions:{environmentKey:'dev'}},codexSnapshot:snapshot({available:false,jobExecution:false})}));assert.match(html,/does not support Workflow job execution/);assert.doesNotMatch(html,/capabilities are unavailable/);assert.match(html,/<button disabled=""[^>]*>Save Agent<\/button>/)});
test('fully ready Codex snapshot has no readiness blocker and enables save',()=>{const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:{id:'saved',name:'Saved',description:'',masterPrompt:'Act.',connectionKey:'codex-primary',adapterOptions:{environmentKey:'dev'}},codexSnapshot:snapshot()}));assert.match(html,/Development \/ dev/);assert.doesNotMatch(html,/This Agent cannot currently be saved/);assert.match(html,/<button class="[^"]*">Save Agent<\/button>/);assert.doesNotMatch(html,/<button disabled=""[^>]*>Save Agent/)});
test('environment discovery survives disconnected model discovery with clear feedback',()=>{const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:{id:'saved',name:'Saved',description:'',masterPrompt:'Act.',connectionKey:'codex-primary',adapterOptions:{environmentKey:'dev'}},codexSnapshot:snapshot({available:false,authenticated:false,modelCatalogAvailable:false,models:[]})}));for(const value of ['Development / dev','ChatGPT is not connected','Codex model discovery is currently unavailable','This Agent cannot currently be saved'])assert.ok(html.includes(value),value)});
test('saved Codex values remain explicit when live catalogues no longer advertise them',()=>{const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:{id:'saved',name:'Saved',description:'',masterPrompt:'Act.',connectionKey:'codex-primary',adapterOptions:{environmentKey:'old-env',model:'old-model',reasoningEffort:'old-effort'}},codexSnapshot:snapshot({available:false,models:[]})}));for(const value of ['old-env (saved; live validation unavailable)','old-model (saved; live validation unavailable)','old-effort (saved; unsupported)','selected Codex Runner environment is unavailable'])assert.ok(html.includes(value),value)});
test('Codex Agent options persist only selected public catalogue tokens',()=>{const {buildCodexRunnerAgentOptions}=requireTsx('../components/WorkflowAgentEditor.tsx');assert.deepEqual(buildCodexRunnerAgentOptions('dev','',''),{environmentKey:'dev'});assert.deepEqual(buildCodexRunnerAgentOptions('dev','model-a','high'),{environmentKey:'dev',model:'model-a',reasoningEffort:'high'})});
test('pending external cancellation remains visibly non-terminal and pollable',async()=>{const source=await readFile(new URL('../app/workflows/runs/[runId]/page.tsx',import.meta.url),'utf8');assert.match(source,/run\.status==="cancelling"&&run\.cancellationResult==="cancellation_pending"/);assert.match(source,/Cancellation requested\. External Codex work is still stopping\./);assert.match(source,/terminal=\{terminal\}/);assert.match(source,/\["succeeded","failed","cancelled"\]\.includes\(run\.status\)/)});
