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
