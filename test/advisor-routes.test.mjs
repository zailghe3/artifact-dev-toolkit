import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {installTsxHook} from './render-tsx.mjs';
import {agent,workflow,connection,context} from './support/advisor-fixtures.mjs';
const original=Module._load;let denied=false,reads=0,saves=0,launches=0,received,settings={workflowId:'review',override:null};
const access={...context,repo:context.repository};
Module._load=function(name,parent,isMain){
 if(name==='@/lib/auth')return {requireApiRepositoryAccess:async()=>denied?Response.json({error:'Repository authorisation required'},{status:403}):{access}};
 if(name==='@/lib/advisor-services')return {getAdvisorSettingsStore:async()=>({get:async()=>{reads++;return {settings,revision:1}},save:async(repositoryId,value,revision)=>{assert.equal(repositoryId,42);saves++;return {settings:value,revision:revision+1}}})};
 if(name==='@/lib/workflow-services')return {createWorkflowDefinitionRepository:()=>({listWorkflows:async()=>[{definition:workflow,fileSha:'sha'}],getAgent:async()=>({definition:agent,fileSha:'agent-sha'})}),listWorkflowConnectionIdentityDescriptors:async()=>[connection]};
 if(name==='@/lib/workflow-run-admission')return {launchWorkflowRun:async(...args)=>{launches++;received=args;return Response.json({runId:crypto.randomUUID()},{status:201})},validateAdvisorOverrideModel:async()=>{}};
 return original.call(this,name,parent,isMain);
};
const requireTsx=installTsxHook(),runs=requireTsx('../app/api/advisor/runs/route.ts'),config=requireTsx('../app/api/advisor/settings/route.ts');
const request=(body,path='/api/advisor/runs',origin='https://adt.invalid',method='POST')=>new Request(`https://adt.invalid${path}`,{method,headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});

test('Advisor routes require repository authorisation and a same-origin mutation before accessing configuration',async()=>{
 denied=true;assert.equal((await runs.POST(request({}))).status,403);assert.equal((await config.GET(new Request('https://adt.invalid/api/advisor/settings'))).status,403);assert.equal((await config.PUT(request({},'/api/advisor/settings','https://adt.invalid','PUT'))).status,403);assert.equal(reads+saves+launches,0);
 denied=false;assert.equal((await runs.POST(request({},'/api/advisor/runs','https://evil.invalid'))).status,403);assert.equal((await config.PUT(request({},'/api/advisor/settings','https://evil.invalid','PUT'))).status,403);assert.equal(reads+saves+launches,0);
});
test('Advisor launch resolves authoritative configuration and rejects model-selected workflow/provider arguments',async()=>{
 const body={initialInput:'Analyse review',idempotencyKey:crypto.randomUUID()};assert.equal((await runs.POST(request({...body,workflowId:'privileged'}))).status,400);assert.equal(launches,0);
 settings={workflowId:null,override:null};assert.equal((await runs.POST(request(body))).status,422);assert.equal(launches,0);
 settings={workflowId:'review',override:{connectionKey:'agents',model:'gpt-5'}};assert.equal((await runs.POST(request(body))).status,201);assert.equal(received[1].workflowId,'review');assert.deepEqual(received[2],settings);assert.equal(received[0],access);
});
test('Advisor settings reject invalid definitions and persist only validated repository-scoped settings',async()=>{
 const valid={settings:{workflowId:'review',override:null},revision:1};assert.equal((await config.PUT(request({...valid,settings:{...valid.settings,workflowId:'missing'}},'/api/advisor/settings','https://adt.invalid','PUT'))).status,422);assert.equal(saves,0);
 const incompatible={...valid,settings:{...valid.settings,override:{connectionKey:'agents',model:'gpt-6-luna'}}};
 const rejection=await config.PUT(request(incompatible,'/api/advisor/settings','https://adt.invalid','PUT'));
 assert.equal(rejection.status,422);
 const failure=await rejection.json();
 assert.equal(failure.code,'agent_tool_model_unsupported');
 assert.match(failure.error,/gpt-6-luna.*supported tool-capable model/);
 assert.equal(saves,0);
 const response=await config.PUT(request(valid,'/api/advisor/settings','https://adt.invalid','PUT'));assert.equal(response.status,200);assert.equal((await response.json()).revision,2);assert.equal(saves,1);
});
