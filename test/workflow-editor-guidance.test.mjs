import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {installTsxHook} from './render-tsx.mjs';
import {definitionIdDraftReducer,definitionIdFromName} from '../lib/definition-id.ts';
import {workflowSections} from '../lib/workflow-navigation.ts';
import {workflowRunPresentation} from '../lib/workflow-run-presentation.ts';

const requireTsx=installTsxHook();
const {AppRouterContext}=requireTsx('next/dist/shared/lib/app-router-context.shared-runtime');
const {WorkflowAgentEditor,buildCodexRunnerAgentOptions}=requireTsx('../components/WorkflowAgentEditor.tsx');
const {WorkflowDefinitionEditor}=requireTsx('../components/WorkflowDefinitionEditor.tsx');
const router={back(){},forward(){},refresh(){},push(){},replace(){},prefetch(){}};
const render=(component)=>renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:router},component));
const connection={key:'deterministic-test',name:'Deterministic test',adapter:'deterministic-test',enabled:true};
const agent={id:'planning-agent',name:'Planning Agent'};
const codexConnection={key:'codex-primary',name:'Codex',adapter:'codex-runner',enabled:false,capabilities:{asynchronous:true,cancellation:true}};
const snapshot=(overrides={})=>({configured:true,reachable:true,capabilitiesAvailable:true,codexAvailable:true,jobExecution:true,environmentCatalogAvailable:true,authenticated:true,authStatusAvailable:true,modelCatalogAvailable:true,available:true,environments:[{key:'dev',name:'Development',enabled:true,ready:true,sandbox:'workspace-write'},{key:'offline',name:'Offline',enabled:true,ready:false,sandbox:'read-only'}],models:[{id:'model-a',displayName:'Model A',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'high',description:'First'},{reasoningEffort:'low',description:'Second'}]}],...overrides});
const savedAgent=(adapterOptions={})=>({id:'saved',name:'Saved',description:'',masterPrompt:'Act.',connectionKey:'codex-primary',adapterOptions});
const saveDisabled=html=><button[^>]*disabled=""[^>]*>Save Agent<\/button>/.test(html);

test('shared definition ID generation is normalized, bounded, and schema-compatible',()=>{
 assert.equal(definitionIdFromName('Todo List Planner'),'todo-list-planner');
 assert.equal(definitionIdFromName('Security & Review Agent'),'security-review-agent');
 assert.equal(definitionIdFromName('  Planning / Review -- V2 '),'planning-review-v2');
 assert.equal(definitionIdFromName('Agent @#$% Test'),'agent-test');
 assert.equal(definitionIdFromName(' /\\.. "?\u0000 # % & '),'');
 assert.equal(definitionIdFromName('Café Über'),'caf-ber');
 const long=definitionIdFromName(`${'a'.repeat(79)} & more`);
 assert.ok(long.length<=80);
 assert.match(long,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test('shared ID draft behavior follows names until a manual override',()=>{
 let draft={name:'',id:'',idOverridden:false};
 draft=definitionIdDraftReducer(draft,{type:'name',value:'Security Agent'});
 assert.equal(draft.id,'security-agent');
 draft=definitionIdDraftReducer(draft,{type:'id',value:'my-reviewer'});
 draft=definitionIdDraftReducer(draft,{type:'name',value:'Different Name'});
 assert.equal(draft.id,'my-reviewer');
});

test('Agent create and edit forms expose required fields and immutable persisted IDs',()=>{
 const create=render(React.createElement(WorkflowAgentEditor,{connections:[connection]}));
 assert.match(create,/<input(?=[^>]*name="name")(?=[^>]*required="")/);
 assert.match(create,/<input(?=[^>]*name="id")(?=[^>]*required="")/);
 assert.match(create,/<textarea(?=[^>]*name="masterPrompt")(?=[^>]*required="")/);
 assert.match(create,/<select(?=[^>]*name="connectionKey")(?=[^>]*required="")/);
 const edit=render(React.createElement(WorkflowAgentEditor,{connections:[connection],initial:{id:'existing-agent',name:'Existing Agent',description:'',masterPrompt:'Act.',connectionKey:'deterministic-test'}}));
 assert.match(edit,/<input(?=[^>]*name="id")(?=[^>]*required="")(?=[^>]*readOnly="")(?=[^>]*value="existing-agent")/);
});

test('Workflow create and edit forms require at least one ordered Agent and immutable persisted IDs',()=>{
 const create=render(React.createElement(WorkflowDefinitionEditor,{agents:[agent]}));
 assert.match(create,/<input(?=[^>]*name="name")(?=[^>]*required="")/);
 assert.match(create,/<input(?=[^>]*name="id")(?=[^>]*required="")/);
 assert.match(create,/<select(?=[^>]*name="agent-0")(?=[^>]*required="")/);
 const edit=render(React.createElement(WorkflowDefinitionEditor,{agents:[agent],initial:{id:'existing-workflow',name:'Existing Workflow',description:'',steps:[{agentId:agent.id}]}}));
 assert.match(edit,/<input(?=[^>]*name="id")(?=[^>]*required="")(?=[^>]*readOnly="")(?=[^>]*value="existing-workflow")/);
});

test('Workflow navigation model keeps the definitions destination labelled Workflows',()=>{
 assert.deepEqual(workflowSections.find(item=>item.href==='/workflows/definitions')?.label,'Workflows');
 assert.equal(workflowSections.some(item=>item.label==='Definitions'),false);
});

test('Codex remains selectable even when live execution is unavailable',()=>{
 const html=render(React.createElement(WorkflowAgentEditor,{connections:[connection,codexConnection],codexSnapshot:snapshot({available:false,authenticated:false,modelCatalogAvailable:false,models:[]})}));
 assert.match(html,/<option value="codex-primary"/);
 assert.doesNotMatch(html,/<option value="codex-primary" disabled/);
});

test('Codex environment choices preserve ready selection, disable unavailable environments, and expose no private Runner settings',()=>{
 const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:savedAgent({environmentKey:'dev'}),codexSnapshot:snapshot()}));
 assert.match(html,/<option value="dev" selected=""/);
 assert.match(html,/<option value="offline" disabled=""/);
 assert.doesNotMatch(html,/cwd|CODEX_RUNNER_SHARED_SECRET|runner-secret/);
});

test('unavailable Codex capabilities block save without disabling the saved connection',()=>{
 for(const overrides of [{available:false,codexAvailable:false},{available:false,capabilitiesAvailable:false,codexAvailable:false,jobExecution:false},{available:false,jobExecution:false}]){
  const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:savedAgent({environmentKey:'dev'}),codexSnapshot:snapshot(overrides)}));
  assert.equal(saveDisabled(html),true);
  assert.doesNotMatch(html,/<option value="codex-primary" disabled/);
  assert.match(html,/<option value="dev"/);
 }
});

test('fully ready Codex configuration enables save',()=>{
 const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:savedAgent({environmentKey:'dev'}),codexSnapshot:snapshot()}));
 assert.equal(saveDisabled(html),false);
});

test('saved missing model remains represented and blocks save',()=>{
 const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:savedAgent({environmentKey:'dev',model:'old-model'}),codexSnapshot:snapshot()}));
 assert.match(html,/<option value="old-model"/);
 assert.equal(saveDisabled(html),true);
});

test('saved unsupported reasoning effort remains represented and blocks save',()=>{
 const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:savedAgent({environmentKey:'dev',model:'model-a',reasoningEffort:'xhigh'}),codexSnapshot:snapshot()}));
 assert.match(html,/<option value="xhigh"/);
 assert.equal(saveDisabled(html),true);
});

test('advertised model choices and provider defaults do not introduce a readiness blocker',()=>{
 for(const adapterOptions of [{environmentKey:'dev'},{environmentKey:'dev',model:'model-a',reasoningEffort:'high'}]){
  const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:savedAgent(adapterOptions),codexSnapshot:snapshot()}));
  assert.equal(saveDisabled(html),false);
 }
});

test('saved catalogue values remain represented when live catalogues no longer advertise them',()=>{
 const html=render(React.createElement(WorkflowAgentEditor,{connections:[codexConnection],initial:savedAgent({environmentKey:'old-env',model:'old-model',reasoningEffort:'old-effort'}),codexSnapshot:snapshot({available:false,models:[]})}));
 for(const value of ['old-env','old-model','old-effort'])assert.match(html,new RegExp(`value="${value}"`));
 assert.equal(saveDisabled(html),true);
});

test('Codex Agent options persist only selected public catalogue tokens',()=>{
 assert.deepEqual(buildCodexRunnerAgentOptions('dev','',''),{environmentKey:'dev'});
 assert.deepEqual(buildCodexRunnerAgentOptions('dev','model-a','high'),{environmentKey:'dev',model:'model-a',reasoningEffort:'high'});
});

test('workflow run presentation keeps pending external cancellation non-terminal and pollable',()=>{
 const pending=workflowRunPresentation('cancelling','cancellation_pending');
 assert.equal(pending.terminal,false);
 assert.equal(pending.cancellationPending,true);
 assert.ok(pending.cancellationMessage);
 assert.equal(workflowRunPresentation('succeeded').terminal,true);
 assert.equal(workflowRunPresentation('failed').terminal,true);
 assert.equal(workflowRunPresentation('cancelled').terminal,true);
 assert.equal(workflowRunPresentation('running').terminal,false);
});
