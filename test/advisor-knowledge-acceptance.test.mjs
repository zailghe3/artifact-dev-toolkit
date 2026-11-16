import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFixture} from './support/native-adt-fixture.mjs';
import {database,context,run,agent,workflow} from './support/advisor-fixtures.mjs';
import {D1WorkflowRunStorage} from '../lib/workflow-d1-storage.ts';
import {KnowledgeProposalStore} from '../lib/advisor-knowledge-proposals.ts';
import {document,knowledgeFixture} from './support/knowledge-fixture.mjs';
import {SENSITIVE_ADT_TOOLS} from '../lib/adt-data-contract.ts';

test('an independent Advisor investigation uses approved observability and Git knowledge, then only a human publishes a reusable finding',async t=>{
 const db=await database(t),storage=new D1WorkflowRunStorage(db),target=run();await storage.createRun(target);await storage.ensureGraphActivation(target.id,'analyse','failed-activation');await storage.claimGraphNode(target.id,'analyse','Workflow input','failed-activation');await storage.failStep(target.id,'analyse',1,1,{category:'provider_timeout',safeMessage:'Timed out',retryable:true});
 const git=knowledgeFixture();git.add(document());let turn=0;const evidence=[];
 const plan=[['adt_workflow_read',{workflowId:workflow.id}],['adt_executions_list',{workflowId:workflow.id}],['adt_agent_prompt_read',{agentId:agent.id,runId:target.id}],['adt_execution_content_read',{runId:target.id,selection:'steps',stepId:'analyse'}],['adt_execution_errors_read',{runId:target.id}],['adt_tool_execution_read',{runId:target.id}],['adt_advisor_knowledge_search',{id:'retry-policy'}]];
 const f=await nativeFixture(t,{db,tools:plan.map(p=>p[0]),knowledgeReader:git.repository,executionLimits:{modelTurns:12,toolExecutions:12,toolProposals:12},remote:{agentOperation:async(path,payload)=>{
  assert.equal(path,'/v1/agents/progress');const prior=payload.request.conversation.at(-1);if(prior?.role==='tool'){const result=JSON.parse(prior.text);assert.equal(result.ok,true);evidence.push(result.result)}
  const next=plan[turn++];return next?{version:1,text:'',calls:[{id:`call-${turn}`,name:next[0],arguments:next[1]}]}:{version:1,text:'Observed timeout in review; retry-policy recommends inspecting ambiguous operations first. Hypothesis: provider latency. Implementation and outcome are unverified. Save the reusable finding after review.',calls:[]};
 }}});
 let result,approved=0;for(let i=0;i<60;i++){
  result=await f.step();for(const call of await f.journal.calls(f.id)){const approval=await f.journal.approval(call);if(approval?.status==='pending'){assert.ok(SENSITIVE_ADT_TOOLS.includes(call.tool_key));await f.journal.decide({runId:f.value.id,approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved',actor:'reviewer'});approved++}}
  if(result.state==='completed')break;
 }
 assert.equal(result.state,'completed');assert.equal(approved,4);assert.equal(f.reads,7);assert.equal(git.writes.length,0);assert.equal(evidence.at(-1).metadata.id,'retry-policy');assert.match(evidence.at(-1).revision,/^[a-f0-9]{40}$/);assert.match(result.outputText,/Hypothesis/);
 const proposals=new KnowledgeProposalStore(db,context,{githubId:123,login:'reviewer',sessionId:'human-browser'}),finding={...document('timeout-finding',{type:'finding',runIds:[target.id],related:['retry-policy']}),body:result.outputText};
 const draft=await proposals.save({document:finding,expectedSha:null});assert.equal(git.writes.length,0);const reviewed=await proposals.review(draft.id,draft.revision);assert.equal(git.writes.length,0);
 await proposals.publish(draft.id,draft.revision,reviewed.reviewToken,(document,sha,actor)=>git.repository.publish(document,sha,actor));assert.equal(git.writes.length,1);assert.equal(git.writes[0].target,'advisor/knowledge/timeout-finding.md');
 const later=await nativeFixture(t,{db,tool:'adt_advisor_knowledge_search',arguments:{id:'timeout-finding'},tools:['adt_advisor_knowledge_search'],knowledgeReader:git.repository});assert.equal((await later.finish()).state,'completed');assert.equal(later.lastEvidence.result.body,finding.body);assert.equal(later.lastEvidence.result.untrusted,true);assert.notEqual(later.value.id,f.value.id);assert.equal(git.writes.length,1);
});
