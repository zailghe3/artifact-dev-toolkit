import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {nativeFixture} from '../support/native-adt-fixture.mjs';
import {createRuntimeServer} from '../../adt-runtime/dist/server.js';
import {RemoteOpenAIAgentsRuntime} from '../../lib/adt-runtime-client.ts';
const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),auth='advisor-runtime-integration-'.repeat(3);
for(const provider of ['openai-agents','anthropic-messages','ollama-chat'])test(`${provider}: Advisor resumes through ordinary Runtime with grounded native evidence and no external tool authority`,async t=>{
 let turns=0,runtime,remote;
 const start=async()=>{
  runtime=await createRuntimeServer({host:'127.0.0.1',port:0,authSecret:auth,privateKeyPem:keys.privateKey,revision:'advisor-integration',logger:()=>{},ollamaAllowedBaseUrls:'http://ollama:11434',providerHttp:{fetcher:async(url,init)=>{
   const body=JSON.parse(init.body);if(String(url).endsWith('/api/show'))return Response.json({capabilities:['tools']});const first=++turns===1;
   if(!first){assert.match(JSON.stringify(body),/"?review/);assert.doesNotMatch(JSON.stringify(body),/SENSITIVE_STARTER|SENSITIVE_INPUT|SENSITIVE_OUTPUT|SENSITIVE_RAW_ERROR/)}
   const name='adt_workflow_read',args={workflowId:'review'},text='Review weaknesses are grounded in the recorded workflow revision.';
   if(provider==='openai-agents')return Response.json({id:`chat-${turns}`,object:'chat.completion',created:1,model:'gpt-5',usage:{prompt_tokens:10,completion_tokens:5},choices:[{index:0,finish_reason:first?'tool_calls':'stop',message:first?{role:'assistant',content:null,tool_calls:[{id:'original-call',type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:text}}]});
   if(provider==='anthropic-messages')return Response.json({type:'message',stop_reason:first?'tool_use':'end_turn',usage:{input_tokens:10,output_tokens:5},content:first?[{type:'tool_use',id:'original-call',name,input:args}]:[{type:'text',text}]});
   return Response.json({done:true,prompt_eval_count:10,eval_count:5,message:{role:'assistant',content:first?'':text,...(first?{tool_calls:[{function:{name,arguments:args}}]}:{})}});
  }},mcpFetcher:async()=>assert.fail('Advisor cannot dispatch MCP')});
  await runtime.listen();remote=new RemoteOpenAIAgentsRuntime({baseUrl:`http://127.0.0.1:${runtime.server.address().port}`,authSecret:auth,wrappingPublicKey:keys.publicKey});
 };
 await start();t.after(()=>runtime.close());
 const f=await nativeFixture(t,{provider,remote:{agentOperation:async(path,payload,credential)=>{assert.equal(path,'/v1/agents/progress');return remote.agentOperation(path,payload,credential)}}});
 await f.step();assert.equal(f.reads,0);assert.equal(turns,1);await runtime.close();await start();
 const result=await f.finish();assert.equal(result.state,'completed');assert.match(result.outputText,/grounded/);assert.equal(f.reads,1);assert.equal(turns,2);
 const saved=(await f.journal.calls(f.id))[0];assert.equal(saved.state,'completed');assert.equal(saved.alias,'adt_workflow_read');assert.doesNotMatch(saved.result_json,/SENSITIVE_/);
 assert.equal((await f.step()).state,'completed');assert.equal(f.reads,1);assert.equal(turns,2);
 const metadata=await f.data.execute('adt_execution_metrics',{},f.value.repositoryContext);assert.equal(metadata.tokens.available,true);assert.equal(metadata.tokens.recordedTotal,30);assert.equal(metadata.cost.available,false);
});

test('ordinary Runtime handles approved prompt evidence and Git knowledge while publication stays outside model authority',async t=>{
 const {knowledgeFixture,document}=await import('../support/knowledge-fixture.mjs'),git=knowledgeFixture();git.add(document());let turns=0;
 const runtime=await createRuntimeServer({host:'127.0.0.1',port:0,authSecret:auth,privateKeyPem:keys.privateKey,revision:'advisor-knowledge-integration',logger:()=>{},providerHttp:{fetcher:async(url,init)=>{
  const payload=JSON.parse(init.body);assert.ok(payload.tools.every(tool=>tool.function.name!=='adt_advisor_knowledge_publish'));
  turns++;const next=turns===1?{name:'adt_agent_prompt_read',arguments:JSON.stringify({agentId:'analyst'})}:turns===2?{name:'adt_advisor_knowledge_search',arguments:JSON.stringify({id:'retry-policy'})}:undefined;
  if(turns===2)assert.match(JSON.stringify(payload),/SENSITIVE_PROMPT/);if(turns===3)assert.match(JSON.stringify(payload),/Accepted choice/);
  return Response.json({id:`knowledge-${turns}`,object:'chat.completion',created:1,model:'gpt-5',choices:[{index:0,finish_reason:next?'tool_calls':'stop',message:next?{role:'assistant',content:null,tool_calls:[{id:`call-${turns}`,type:'function',function:next}]}:{role:'assistant',content:'Evidence and prior decision retrieved. Publication requires human review.'}}]});
 }},mcpFetcher:async()=>assert.fail('No external tool authority')});
 await runtime.listen();t.after(()=>runtime.close());const remote=new RemoteOpenAIAgentsRuntime({baseUrl:`http://127.0.0.1:${runtime.server.address().port}`,authSecret:auth,wrappingPublicKey:keys.publicKey});
 const f=await nativeFixture(t,{tools:['adt_agent_prompt_read','adt_advisor_knowledge_search'],knowledgeReader:git.repository,remote});
 await f.step();await f.step();assert.equal(f.reads,0);assert.equal(turns,1);const call=(await f.journal.calls(f.id))[0],approval=await f.journal.approval(call);assert.equal(approval.status,'pending');
 await f.journal.decide({runId:f.value.id,approvalId:approval.id,decisionId:crypto.randomUUID(),decision:'approved',actor:'reviewer'});const outcome=await f.finish();assert.equal(outcome.state,'completed');assert.equal(turns,3);assert.equal(f.reads,2);assert.equal(git.writes.length,0);assert.match(outcome.outputText,/requires human review/);
});
