import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/agent-tool-fixture.mjs';
import {AgentJournal} from '../lib/agent-journal.ts';
import {AGENT_TOOL_EXECUTION_MS,AGENT_TOOL_RECOVERY_GRACE_MS} from '../adt-runtime/src/agent-contract.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const resultBytes=value=>Buffer.byteLength(JSON.stringify(value));
async function events(f,kind){return(await f.db.prepare('SELECT * FROM agent_execution_events WHERE continuation_id=? AND kind=?').bind(f.options.id,kind).all()).results}
async function held(t){
 const entered=deferred(),returned=deferred();let executions=0;
 const f=await fixture(t,{policy:{classification:'read_only'},options:{execute:async()=>{executions++;entered.resolve();return returned.promise}}});
 await f.step();const running=f.step();await entered.promise;
 const call=(await f.journal.calls(f.options.id))[0];
 return{f,call,running,returned,get executions(){return executions}};
}
const decision=(f,call,kind='success')=>({runId:f.options.runId,invocationId:call.id,admissionId:call.admission_id,decisionId:crypto.randomUUID(),decision:kind,basis:'Verified the exact target action and stopped any prior executor',...(kind==='success'?{result:'operator verified'}:{}),actor:'operator'});
async function drain(f){for(let i=0;i<6;i++){const outcome=await f.step();if(outcome.state!=='pending')return outcome}assert.fail('Agent did not finish')}

test('absolute dispatch deadline plus grace precedes uncertainty; late completion recovers the original admission once',async t=>{
 const h=await held(t),{f,call}=h;
 assert.equal(call.execution_deadline_at,call.admitted_at+AGENT_TOOL_EXECUTION_MS);
 f.advance(AGENT_TOOL_EXECUTION_MS+AGENT_TOOL_RECOVERY_GRACE_MS-1);await f.step();assert.equal((await f.journal.call(call.id)).state,'admitted');
 f.advance(1);await f.step();assert.equal((await f.journal.call(call.id)).state,'unknown');assert.equal((await f.journal.get(f.options.id)).state,'reconciliation');
 h.returned.resolve({late:true});await h.running;
 assert.equal((await f.journal.call(call.id)).state,'completed');assert.equal((await f.journal.get(f.options.id)).state,'tools');
 assert.equal((await drain(f)).outputText,'finished');assert.equal(h.executions,1);assert.equal(f.models,2);
 assert.equal((await events(f,'execution_result')).length,1);assert.equal((await f.journal.get(f.options.id)).tool_result_bytes,resultBytes({ok:true,result:{late:true}}));
 assert.equal(await f.journal.markUnknown(call,'stale recovery',true),false);assert.equal((await f.journal.call(call.id)).state,'completed');
});

test('a stale timeout observer cannot move a completed invocation into reconciliation',async t=>{
 const h=await held(t),{f,call}=h;f.advance(46000);h.returned.resolve('executor result');await h.running;
 assert.equal(await f.journal.markUnknown(call,'execution_deadline',true),false);
 assert.equal((await f.journal.get(f.options.id)).state,'tools');assert.equal((await events(f,'execution_unknown')).length,0);
});

for(const order of ['executor','operator','concurrent'])test(`operator success and late completion have one authoritative outcome (${order})`,async t=>{
 const h=await held(t),{f,call}=h;f.advance(46000);await f.step();const action=decision(f,call);
 let reconciled;
 if(order==='operator'){await f.journal.reconcile(action);reconciled=true;h.returned.resolve('executor result');await h.running}
 else if(order==='executor'){h.returned.resolve('executor result');await h.running;await assert.rejects(f.journal.reconcile(action));reconciled=false}
 else{const reconciliation=f.journal.reconcile(action);h.returned.resolve('executor result');const [settled]=await Promise.allSettled([reconciliation,h.running]);reconciled=settled.status==='fulfilled'}
 const saved=await f.journal.call(call.id),expected=reconciled?{ok:true,result:'operator verified',reconciled:true}:{ok:true,result:'executor result'};
 assert.deepEqual(JSON.parse(saved.result_json),expected);assert.equal((await events(f,'execution_result')).length,1);
 assert.equal((await f.journal.get(f.options.id)).tool_result_bytes,resultBytes(expected));
 assert.equal((await drain(f)).outputText,'finished');const journal=await f.journal.get(f.options.id);
 assert.equal(JSON.parse(journal.conversation_json).filter(turn=>turn.role==='tool')[0].text,JSON.stringify(expected));assert.equal(h.executions,1);
});

test('unresolved reconciliation retains the admission token and accepts a later executor result',async t=>{
 const h=await held(t),{f,call}=h;f.advance(46000);await f.step();await f.journal.reconcile(decision(f,call,'unresolved'));
 assert.equal((await f.journal.call(call.id)).admission_id,call.admission_id);
 h.returned.resolve('verified late');await h.running;assert.equal((await drain(f)).outputText,'finished');assert.equal((await events(f,'execution_result')).length,1);
});

for(const late of ['success','failure'])test(`confirmed non-execution fences a late ${late} from a replacement admission`,async t=>{
 const h=await held(t),{f,call}=h;f.advance(46000);await f.step();const action=decision(f,call,'not_executed');await f.journal.reconcile(action);
 const entered=deferred(),returned=deferred();f.options.execute=async()=>{entered.resolve();return returned.promise};const second=f.step();await entered.promise;
 const replacement=await f.journal.call(call.id);assert.notEqual(replacement.admission_id,call.admission_id);
 if(late==='failure')h.returned.reject(Error('old definite failure'));else h.returned.resolve('old success');await h.running;
 assert.equal((await f.journal.call(call.id)).state,'admitted');assert.equal((await f.journal.call(call.id)).result_json,null);assert.equal((await events(f,'execution_result')).length,0);
 assert.equal(await f.journal.finish(call,call.admission_id,{ok:true,result:'duplicate old'}),false);
 returned.resolve('replacement result');await second;assert.equal((await drain(f)).outputText,'finished');assert.equal((await f.journal.get(f.options.id)).tool_executions,2);
 assert.equal((await events(f,'execution_result')).length,1);await f.journal.reconcile(action);assert.equal((await f.journal.call(call.id)).state,'completed');
});

test('non-execution cannot re-admit while a dispatch grant is still valid; stale operator screens cannot settle a new admission',async t=>{
 const h=await held(t),{f,call}=h;await f.journal.markUnknown(call,'lost response');
 await assert.rejects(f.journal.reconcile(decision(f,call,'not_executed')));assert.equal((await f.journal.call(call.id)).state,'unknown');
 f.advance(31000);await f.journal.reconcile(decision(f,call,'not_executed'));
 f.options.execute=async()=>{throw Object.assign(Error('new unknown'),{ambiguous:true})};await f.step();
 assert.equal((await f.journal.call(call.id)).state,'unknown');await assert.rejects(f.journal.reconcile(decision(f,call)));
 h.returned.resolve('obsolete');await h.running;assert.equal((await f.journal.call(call.id)).state,'unknown');assert.equal(f.models,1);
});

test('duplicate result callbacks count bytes and audit exactly once',async t=>{
 const h=await held(t),{f,call}=h,results=await Promise.all([f.journal.finish(call,call.admission_id,{ok:true,result:'first'}),f.journal.finish(call,call.admission_id,{ok:true,result:'second'})]);
 assert.equal(results.filter(Boolean).length,1);h.returned.resolve('third');await h.running;
 const saved=await f.journal.call(call.id);assert.equal((await f.journal.get(f.options.id)).tool_result_bytes,Buffer.byteLength(saved.result_json));assert.equal((await events(f,'execution_result')).length,1);
});

test('cancellation preserves a late admitted result and cannot be undone by reconciliation or continuation',async t=>{
 const h=await held(t),{f,call}=h;await f.db.prepare("UPDATE workflow_runs SET cancel_requested_at='now',status='cancelling' WHERE id=?").bind(f.options.runId).run();
 await f.journal.cancelPending(f.options.runId);await assert.rejects(f.journal.reconcile(decision(f,call)));
 h.returned.resolve('side effect completed');await h.running;assert.equal((await f.journal.get(f.options.id)).state,'cancelled');assert.equal((await f.journal.call(call.id)).state,'completed');
 assert.equal((await f.step()).state,'failed');assert.equal(f.models,1);assert.equal((await events(f,'execution_result')).length,1);
});

for(const stricter of [false,true])test(`approval expiry is checked atomically at admission (${stricter?'live restriction':'frozen expiry'})`,async t=>{
 const f=await fixture(t,{policy:{expirySeconds:stricter?86400:60}});await f.step();await f.step();await f.decide('approved');
 if(stricter)f.options.authorize=async()=>[{...f.tool.policy,expirySeconds:60}];
 const admit=f.journal.admit.bind(f.journal);f.journal.admit=async(...args)=>{f.advance(60000);return admit(...args)};
 await f.step();assert.equal(f.executions,0);assert.equal((await f.journal.calls(f.options.id))[0].state,'eligible');
 await f.step();assert.equal(f.executions,0);assert.equal((await f.journal.calls(f.options.id))[0].state,'denied');
});

test('concurrent duplicate approval decisions create one decision audit and no conflicting outcome',async t=>{
 const f=await fixture(t);await f.step();await Promise.all([f.step(),f.step()]);const{approval}=await f.approval();
 const action={runId:f.options.runId,approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved',actor:'reviewer'};
 const results=await Promise.all([f.journal.decide(action),f.journal.decide(action)]);assert.equal(results.filter(Boolean).length,1);
 assert.equal((await events(f,'approval_requested')).length,1);assert.equal((await events(f,'approval_decision')).length,1);
});

test('a stale denial cannot replace an admitted result',async t=>{
 const h=await held(t),{f,call}=h;assert.equal(await f.journal.setCall({...call,revision:call.revision-1,state:'eligible'},'eligible','denied',{ok:false,denied:true}),false);
 h.returned.resolve('safe');await h.running;assert.equal((await f.journal.call(call.id)).state,'completed');assert.equal((await events(f,'tool_denied')).length,0);
});

test('aggregate UTF-8 result bytes survive replacement and stop on overflow without inventing uncertainty',async t=>{
 const payload={text:'é'.repeat(300)};let executions=0;
 const f=await fixture(t,{agent:{executionLimits:{toolResultBytes:1024}},policy:{classification:'read_only'},options:{progress:async()=>({version:1,text:'',calls:[{id:'first',name:'change',arguments:{repo:'safe'}},{id:'second',name:'change',arguments:{repo:'safe'}}]}),execute:async()=>{executions++;return payload}}});
 await f.step();await f.step();const expected=resultBytes({ok:true,result:payload});assert.equal((await f.journal.get(f.options.id)).tool_result_bytes,expected);
 f.options.journal=new AgentJournal(f.db,f.journal.now,f.environment);await f.step();const c=await f.journal.get(f.options.id),calls=await f.journal.calls(c.id);
 assert.equal(c.tool_result_bytes,expected*2);assert.equal(c.state,'failed');assert.equal(calls[1].state,'completed');assert.equal(calls[1].result_json,null);
 assert.equal(executions,2);assert.equal(f.models,0);assert.equal((await events(f,'execution_unknown')).length,0);assert.ok((await events(f,'failure')).some(e=>JSON.parse(e.evidence_json).reason==='tool_result_budget_exceeded'));
 assert.equal((await f.step()).state,'failed');
});

test('denials and definite tool failures consume the same aggregate result budget',async t=>{
 const f=await fixture(t);await f.step();await f.step();await f.decide('rejected');await f.step();const call=(await f.journal.calls(f.options.id))[0];
 assert.equal((await f.journal.get(f.options.id)).tool_result_bytes,Buffer.byteLength(call.result_json));
 const g=await fixture(t,{policy:{classification:'read_only'},options:{execute:async()=>{throw Error('definite failure before dispatch')}}});await g.step();await g.step();const failed=(await g.journal.calls(g.options.id))[0];
 assert.equal((await g.journal.get(g.options.id)).tool_result_bytes,Buffer.byteLength(failed.result_json));assert.equal(failed.state,'completed');
});

test('operator success cannot reset aggregate bytes or resume with an over-budget result',async t=>{
 let count=0;const f=await fixture(t,{agent:{executionLimits:{toolResultBytes:1024}},policy:{classification:'read_only'},options:{progress:async()=>({version:1,text:'',calls:[{id:'one',name:'change',arguments:{repo:'safe'}},{id:'two',name:'change',arguments:{repo:'safe'}}]}),execute:async()=>{if(++count===1)return 'x'.repeat(700);throw Object.assign(Error('unknown'),{ambiguous:true})}}});
 await f.step();await f.step();const before=(await f.journal.get(f.options.id)).tool_result_bytes;await f.step();const call=(await f.journal.calls(f.options.id))[1];
 await f.journal.reconcile({...decision(f,call),result:'y'.repeat(700)});assert.equal((await f.journal.get(f.options.id)).tool_result_bytes,before+resultBytes({ok:true,result:'y'.repeat(700),reconciled:true}));assert.equal((await f.journal.get(f.options.id)).state,'failed');assert.equal((await f.journal.call(call.id)).state,'completed');
});

test('concurrent model response callbacks persist proposals and response audit once',async t=>{
 const entered=deferred(),returned=deferred(),f=await fixture(t,{options:{progress:async()=>{entered.resolve();return returned.promise}}});
 const running=f.step();await entered.promise;const c=await f.journal.get(f.options.id),calls=[{proposal:{id:'model-call',name:'change',arguments:{repo:'safe'}},key:f.tool.key,frozen:f.tool.frozen,target:f.tool.target}];
 const results=await Promise.all([f.journal.persistResponse(c,'',calls,4),f.journal.persistResponse(c,'',calls,4)]);assert.equal(results.filter(Boolean).length,1);
 returned.resolve({version:1,text:'',calls:calls.map(call=>call.proposal)});await running;assert.equal((await f.journal.calls(c.id)).length,1);assert.equal((await events(f,'model_response')).length,1);assert.equal((await events(f,'proposed_call')).length,1);
});

test('aggregate result accounting spans model turns rather than resetting at a new proposal batch',async t=>{
 let models=0;const payload='x'.repeat(600),f=await fixture(t,{agent:{executionLimits:{toolResultBytes:1024}},policy:{classification:'read_only'},options:{progress:async()=>({version:1,text:'',calls:[{id:`turn-${++models}`,name:'change',arguments:{repo:'safe'}}]}),execute:async()=>payload}});
 await f.step();await f.step();await f.step();await f.step();await f.step();
 const c=await f.journal.get(f.options.id);assert.equal(c.state,'failed');assert.equal(c.tool_result_bytes,2*resultBytes({ok:true,result:payload}));assert.equal(models,2);
});

test('two operators racing late completion cannot create contradictory reconciliations or resume a terminated Agent',async t=>{
 const h=await held(t),{f,call}=h;f.advance(46000);await f.step();
 const success=f.journal.reconcile(decision(f,call)),termination=f.journal.reconcile(decision(f,call,'terminate'));h.returned.resolve('executor result');
 const results=await Promise.allSettled([success,termination,h.running]);assert.ok(results.slice(0,2).filter(r=>r.status==='fulfilled').length<=1);
 const c=await f.journal.get(f.options.id),saved=await f.journal.call(call.id),audits=await events(f,'reconciliation');assert.ok(audits.length<=1);
 if(saved.state==='cancelled'){assert.equal(c.state,'failed');assert.equal(saved.result_json,null);assert.equal((await f.step()).state,'failed');assert.equal(f.models,1);assert.equal((await events(f,'execution_result')).length,0)}
 else{assert.equal(saved.state,'completed');assert.equal((await events(f,'execution_result')).length,1);assert.equal((await drain(f)).outputText,'finished')}
});

test('concurrent duplicate reconciliation callbacks are idempotent and create one audit',async t=>{
 const h=await held(t),{f,call}=h;f.advance(46000);await f.step();const action=decision(f,call);
 const bothReadDecision=deferred(),allowSecondRead=deferred(),readCall=f.journal.call.bind(f.journal);
 let reads=0;
 t.mock.method(f.journal,'call',async id=>{
  if(id===call.id&&++reads===1)await bothReadDecision.promise;
  else if(id===call.id&&reads===2){bothReadDecision.resolve();await allowSecondRead.promise;}
  return readCall(id);
 });
 const callbacks=[f.journal.reconcile(action),f.journal.reconcile(action)];
 try{await Promise.race(callbacks)}finally{allowSecondRead.resolve()}
 await Promise.all(callbacks);h.returned.resolve('late obsolete');await h.running;
 assert.equal((await events(f,'reconciliation')).length,1);assert.equal((await events(f,'execution_result')).length,1);
});

for(const order of ['cancel_first','result_first'])test(`cancellation and result persistence preserve evidence without resumption (${order})`,async t=>{
 const h=await held(t),{f,call}=h;
 if(order==='cancel_first')await f.journal.cancelPending(f.options.runId);
 h.returned.resolve('known side effect');await h.running;
 if(order==='result_first')await f.journal.cancelPending(f.options.runId);
 assert.equal((await f.journal.get(f.options.id)).state,'cancelled');assert.equal((await f.journal.call(call.id)).state,'completed');assert.equal((await f.step()).state,'failed');assert.equal(f.models,1);
});

test('concurrent approval resumes consume the wait atomically and execute once',async t=>{
 const f=await fixture(t);await f.step();await f.step();await f.decide('approved');await Promise.all([f.step(),f.step(),f.step()]);
 assert.equal(f.executions,1);assert.equal((await f.journal.calls(f.options.id))[0].state,'completed');assert.equal((await drain(f)).outputText,'finished');
});
