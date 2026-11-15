import test from 'node:test';
import assert from 'node:assert/strict';
import {AdtDataTools} from '../lib/adt-data-tools.ts';
import {D1WorkflowRunStorage} from '../lib/workflow-d1-storage.ts';
import {InMemoryWorkflowDefinitionRepository} from '../lib/workflow-definition-repository.ts';
import {ADT_DATA_TOOLS,adtDataArgumentSchemas} from '../lib/adt-data-contract.ts';


import {context,connection,agent,workflow,run,database} from './support/advisor-fixtures.mjs';

test('native ADT tools return bounded structure and repository-filtered evidence without sensitive content',async t=>{
 const db=await database(t),storage=new D1WorkflowRunStorage(db),repo=new InMemoryWorkflowDefinitionRepository();
 await repo.createAgent(agent);await repo.createWorkflow(workflow);await repo.createWorkflow({...workflow,id:'other',name:'Other'});
 const tools=new AdtDataTools(db,repo),good=run();await storage.createRun(good);
 const privateRun=run({repositoryContext:{...context,repositoryId:99}});await storage.createRun(privateRun);
 const absentScope=run({repositoryContext:undefined});await storage.createRun(absentScope);
 await storage.ensureGraphActivation(good.id,'analyse','activation');await storage.claimGraphNode(good.id,'analyse','SENSITIVE_INPUT','activation');
 await storage.failStep(good.id,'analyse',1,1,{category:'provider_timeout',safeMessage:'SENSITIVE_RAW_ERROR',retryable:true});
 await storage.createAutomaticRetryAttempt(good.id,'analyse','activation');await storage.claimGraphNode(good.id,'analyse','SENSITIVE_INPUT','activation');
 await storage.completeStep(good.id,'analyse',1,2,'SENSITIVE_OUTPUT');await storage.completeRun(good.id,'analyse','SENSITIVE_OUTPUT');
 const listing=await tools.execute('adt_workflows_list',{limit:1},context);assert.equal(listing.results.length,1);assert.equal(listing.nextOffset,1);
 assert.equal((await tools.execute('adt_workflows_list',{query:'REVIEW'},context)).results[0].id,'review');
 assert.equal((await tools.execute('adt_workflows_list',{offset:listing.nextOffset,limit:1},context)).nextOffset,null);
 assert.deepEqual((await tools.execute('adt_workflows_list',{query:'missing'},context)).results,[]);
 const read=await tools.execute('adt_workflow_read',{workflowId:workflow.id},context);assert.equal(read.agents[0].connectionKey,connection.key);assert.equal(read.nodes[0].agentId,agent.id);
 assert.deepEqual(await tools.execute('adt_workflow_read',{workflowId:'missing'},context),{available:false,reason:'not_found'});
 const runs=await tools.execute('adt_executions_list',{workflowId:'review',status:'succeeded'},context);assert.deepEqual(runs.results.map(r=>r.id),[good.id]);assert.equal(runs.results[0].failureCategory,null);
 assert.deepEqual((await tools.execute('adt_executions_list',{createdBefore:'2020-01-01T00:00:00Z'},context)).results,[]);
 assert.deepEqual((await tools.execute('adt_executions_list',{createdAfter:'2099-01-01T00:00:00Z'},context)).results,[]);
 const detail=await tools.execute('adt_execution_read',{runId:good.id,limit:1},context);assert.equal(detail.attempts[0].failureCategory,'provider_timeout');assert.equal(detail.nextOffset,1);
 assert.equal((await tools.execute('adt_execution_read',{runId:good.id,offset:1,limit:1},context)).attempts[0].status,'succeeded');
 for(const id of [privateRun.id,absentScope.id,crypto.randomUUID()])assert.deepEqual(await tools.execute('adt_execution_read',{runId:id},context),{available:false,reason:'not_found'});
 const metrics=await tools.execute('adt_execution_metrics',{},context);assert.equal(metrics.sampleSize,1);assert.equal(metrics.retries,1);assert.equal(metrics.statuses.succeeded,1);assert.equal(metrics.tokens.available,false);assert.equal(metrics.cost.reason,'not_recorded');
 const noMetrics=await tools.execute('adt_execution_metrics',{workflowId:'missing'},context);assert.equal(noMetrics.sampleSize,0);assert.equal(noMetrics.meanCompletedDurationMs,null);
 for(const result of [listing,read,runs,detail,metrics])assert.doesNotMatch(JSON.stringify(result),/SENSITIVE_|sec_[a-z]{43}|providerTaskId|masterPrompt|initialInput|outputText/);
 for(const name of ADT_DATA_TOOLS)assert.equal(adtDataArgumentSchemas[name].safeParse({repositoryId:99}).success,false);
 for(const name of ['adt_workflows_list','adt_executions_list'])await assert.rejects(tools.execute(name,{limit:21},context));
 // Status/date pages are deterministic and disjoint.
 const second=run();await storage.createRun(second);const firstPage=await tools.execute('adt_executions_list',{limit:1},context),secondPage=await tools.execute('adt_executions_list',{limit:1,offset:firstPage.nextOffset},context);assert.notEqual(firstPage.results[0].id,secondPage.results[0].id);assert.equal(secondPage.nextOffset,null);
 // Every dimension of repository scope participates in SQL authorisation.
 for(const key of Object.keys(context)){const different={...context,[key]:typeof context[key]==='number'?999:'other'};assert.equal((await tools.execute('adt_executions_list',{},different)).results.length,0)}
});

test('persisted diagnostic evidence is allowlisted and malformed evidence never exposes raw errors',async t=>{
 const db=await database(t),storage=new D1WorkflowRunStorage(db),value=run();await storage.createRun(value);
 const diagnostic={version:1,stage:'checkpoint_gateway',category:'provider_unavailable',orchestrationCode:'checkpoint_backend_unavailable',consecutiveFailures:2,recoveryRetriesAllowed:6,observedAt:new Date().toISOString(),runtimeTransport:{outcome:'response_received',elapsedMs:2,httpStatus:503,clientRequestId:'SENSITIVE_PRIVATE_ID'}};
 await storage.recordOrchestrationDiagnostics(value.id,1,diagnostic);
 const tools=new AdtDataTools(db,{}),result=await tools.execute('adt_execution_read',{runId:value.id},context);assert.equal(result.diagnostic.code,'checkpoint_backend_unavailable');assert.doesNotMatch(JSON.stringify(result),/SENSITIVE_/);
 await db.prepare('UPDATE workflow_runs SET orchestration_diagnostics_json=? WHERE id=?').bind(JSON.stringify({...diagnostic,raw:'SENSITIVE_RAW'}),value.id).run();assert.equal((await tools.execute('adt_execution_read',{runId:value.id},context)).diagnostic,null);
});



test('aggregate metric sampling is bounded and never includes another repository',async t=>{
 const db=await database(t),value=run(),storage=new D1WorkflowRunStorage(db);await storage.createRun(value);
 await db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1001) INSERT INTO workflow_runs(id,engine_version,workflow_id,workflow_revision,workflow_snapshot_json,agent_snapshots_json,agent_revisions_json,connection_snapshots_json,initial_input,status,created_at,updated_at,repository_context_json) SELECT 'sample-'||n,'2','review','sha','{}','{}','{}','{}','SENSITIVE_INPUT','succeeded','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',? FROM seq`).bind(JSON.stringify(context)).run();
 const metrics=await new AdtDataTools(db,{}).execute('adt_execution_metrics',{},context);assert.equal(metrics.sampleSize,1000);assert.equal(metrics.truncated,true);assert.equal(metrics.tokens.available,false);assert.doesNotMatch(JSON.stringify(metrics),/SENSITIVE_/);
});

test('invalid Git Agent options cannot smuggle sensitive free text into metadata projections',async()=>{
 const repo=new InMemoryWorkflowDefinitionRepository();await repo.createAgent({...agent,adapterOptions:{maxOutputTokens:'SENSITIVE_OPTION',reasoningEffort:'SENSITIVE_EFFORT',verbosity:'high',managedGit:'SENSITIVE_CONFIG'}});await repo.createWorkflow(workflow);
 const value=await new AdtDataTools({},repo).execute('adt_workflow_read',{workflowId:'review'},context);assert.deepEqual(value.agents[0].options,{verbosity:'high'});assert.doesNotMatch(JSON.stringify(value),/SENSITIVE_/);
});
