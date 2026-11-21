import test from 'node:test';
import assert from 'node:assert/strict';
import {progressAgentModel,validateConversation} from '../dist/agent-models.js';
import {authorizeJournaledTool} from '../dist/adrian.js';
import {progressWireSchema} from '../dist/agent-http.js';
const schema={type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false};
const request=provider=>({version:1,provider,model:provider==='openai-agents'?'gpt-4.1':provider==='anthropic-messages'?'claude-sonnet-4-5':'qwen3',instructions:'private instructions',conversation:[{role:'user',text:'look up'}],turn:1,tools:[{name:'search',description:'Search',schema}],options:{maxOutputTokens:100},timeoutMs:1000,...(provider==='ollama-chat'?{configuration:{baseUrl:'http://ollama:11434',authMode:'none'}}:{})});
for(const provider of ['openai-agents','anthropic-messages','ollama-chat'])test(`${provider} actual protocol proposes a tool and continues with its exact correlated result`,async()=>{
 const received=[];let models=0;const fetcher=async(url,init)=>{const body=JSON.parse(init.body);received.push({url:String(url),body});assert.ok(!JSON.stringify(body).includes('mcp-secret'));if(String(url).endsWith('/api/show'))return Response.json({capabilities:['completion','tools']});models++;const first=models===1;
  if(provider==='openai-agents')return Response.json({id:`chatcmpl-${models}`,object:'chat.completion',created:123,model:'gpt-4.1',choices:[{index:0,finish_reason:first?'tool_calls':'stop',message:first?{role:'assistant',content:null,tool_calls:[{id:'native-call',type:'function',function:{name:'search',arguments:'{"query":"safe"}'}}]}:{role:'assistant',content:'finished'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  if(provider==='anthropic-messages')return Response.json({id:`msg-${models}`,type:'message',role:'assistant',model:'claude-sonnet-4-5',stop_reason:first?'tool_use':'end_turn',content:first?[{type:'tool_use',id:'native-call',name:'search',input:{query:'safe'}}]:[{type:'text',text:'finished'}],usage:{input_tokens:1,output_tokens:1}});
  return Response.json({done:true,message:first?{role:'assistant',content:'',tool_calls:[{function:{name:'search',arguments:{query:'safe'}}}]}:{role:'assistant',content:'finished'}});
 };
 const input=request(provider),first=await progressAgentModel(input,'model-secret',new Set(['http://ollama:11434']),{fetcher});assert.equal(first.calls.length,1);assert.equal(first.calls[0].name,'search');assert.deepEqual(first.calls[0].arguments,{query:'safe'});
 const result=await progressAgentModel({...input,turn:2,conversation:[...input.conversation,{role:'assistant',text:first.text,calls:first.calls},{role:'tool',callId:first.calls[0].id,name:'search',text:'{"ok":false,"denied":true}',denied:true}]},'model-secret',new Set(['http://ollama:11434']),{fetcher});assert.equal(result.text,'finished');assert.deepEqual(result.calls,[]);assert.equal(models,2);
 const last=received.filter(r=>!r.url.endsWith('/api/show')).at(-1).body;if(provider==='anthropic-messages'){assert.equal(last.messages.at(-1).content[0].tool_use_id,'native-call');assert.equal(last.messages.at(-1).content[0].is_error,true)}else if(provider==='openai-agents'){assert.equal(last.messages.at(-1).tool_call_id,'native-call');assert.equal(last.store,false)}else{assert.equal(last.messages.at(-1).tool_name,'search')}
});
test('model request schema rejects tool credentials and privileged execution authority',()=>{assert.equal(progressWireSchema.safeParse({protocolVersion:'adt-runtime-v1',capability:'agent:progress-v1',requestId:crypto.randomUUID(),request:{...request('ollama-chat'),mcpCredentials:['secret']}}).success,false)});
test('Ollama capability discovery rejects a definitive lack of tools before inference',async()=>{let chats=0;await assert.rejects(progressAgentModel(request('ollama-chat'),'',new Set(['http://ollama:11434']),{fetcher:async url=>{if(String(url).endsWith('/api/chat'))chats++;return Response.json({capabilities:['completion']})}}),{category:'tool_proposals_unsupported'});assert.equal(chats,0)});
test('an unfamiliar model can respond with or without offered tools and an ordinary answer makes no capability claim',async()=>{
 for(const provider of ['openai-agents','anthropic-messages','ollama-chat']){
  const model='vendor-pro-codex-preview';
  for(const hasTools of [true,false]){
   let entries=0,requests=0,metadata=0;
   const input={...request(provider),model,...(hasTools?{}:{tools:[]}),
    ...(provider==='openai-agents'?{options:{maxOutputTokens:100,reasoningEffort:'minimal',verbosity:'high'}}:{})};
   const result=await progressAgentModel(input,'fixture-secret',new Set(['http://ollama:11434']),{
    onProviderEntry:()=>{entries++},
    fetcher:async(url,init)=>{
     if(String(url).endsWith('/api/show')){metadata++;return Response.json({details:{}})}
     requests++;
     const body=JSON.parse(init.body);assert.equal(body.model,model);assert.equal(Boolean(body.tools?.length),hasTools);
     if(provider==='openai-agents'){
      assert.match(String(url),/chat\/completions$/);
      assert.equal(body.max_completion_tokens,100);
      assert.ok(!Object.hasOwn(body,'max_tokens'));
      assert.equal(body.reasoning_effort,'minimal');
      assert.equal(body.verbosity,'high');
      return Response.json({id:'chat-fixture',object:'chat.completion',created:1,model,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'done'}}]});
     }
     if(provider==='anthropic-messages')return Response.json({type:'message',stop_reason:'end_turn',content:[{type:'text',text:'done'}]});
     return Response.json({done:true,message:{content:'done'}});
    },
   });
   assert.equal(result.text,'done');assert.deepEqual(result.calls,[]);
   assert.equal(entries,1);assert.equal(requests,1);assert.equal(metadata,provider==='ollama-chat'&&hasTools?1:0);
  }
 }
});

test('Ollama attempts chat when the metadata endpoint is missing but stops when it reports a missing model',async()=>{
 for(const available of [true,false]){
  const visited=[];
  const progress=progressAgentModel(request('ollama-chat'),'',new Set(['http://ollama:11434']),{
   fetcher:async url=>{
    const path=new URL(url).pathname;visited.push(path);
    if(path==='/api/show')return available?new Response('404 page not found',{status:404}):Response.json({error:"model 'qwen3' not found"},{status:404});
    return Response.json({done:true,message:{content:'done'}});
   },
  });
  if(available)assert.equal((await progress).text,'done');
  else await assert.rejects(progress,{category:'model_unavailable'});
  assert.deepEqual(visited,available?['/api/show','/api/chat']:['/api/show']);
 }
});

test('Runtime independently enforces documented API and settings requirements before inference',async()=>{
 const fetcher=()=>assert.fail('Provider request must not be made');
 const input=request('openai-agents');
 await assert.rejects(progressAgentModel({...input,model:'gpt-5-pro',tools:[]},'fixture-secret',new Set(),{fetcher}),{category:'provider_api_unsupported'});
 await assert.rejects(progressAgentModel({...input,model:'gpt-6-luna'},'fixture-secret',new Set(),{fetcher}),{category:'unsupported_model_option'});
 await assert.rejects(progressAgentModel({...request('anthropic-messages'),options:{verbosity:'high'}},'fixture-secret',new Set(),{fetcher}),{category:'unsupported_model_option'});
});

test('provider rejections distinguish tool capability, endpoint, availability and settings without exposing payloads',async()=>{
 for(const [provider,status,body,category] of [
  ['openai-agents',400,{error:{type:'invalid_request_error',param:'tools',code:'unsupported_parameter',message:'private'}},'tool_proposals_unsupported'],
  ['openai-agents',404,{error:{code:'model_not_found',message:'private'}},'model_unavailable'],
  ['openai-agents',400,{error:{message:'This model is not supported in the Chat Completions API. SENSITIVE_PRIVATE'}},'provider_api_unsupported'],
  ['openai-agents',400,{error:{code:'unsupported_value',param:'reasoning_effort',message:'SENSITIVE_PRIVATE'}},'unsupported_model_option'],
  ['openai-agents',400,{error:{code:'invalid_request_error',param:'messages',message:'SENSITIVE_PRIVATE'}},'provider_rejected'],
  ['openai-agents',503,{error:{message:'SENSITIVE_PRIVATE'}},'provider_start_ambiguous'],
  ['anthropic-messages',400,{type:'error',error:{type:'invalid_request_error',message:'This model does not support tool use. SENSITIVE_PRIVATE'}},'tool_proposals_unsupported'],
  ['ollama-chat',400,{error:'"SENSITIVE_PRIVATE" does not support tools'},'tool_proposals_unsupported'],
 ]){
  let calls=0;
  const fetcher=async url=>{
   if(String(url).endsWith('/api/show'))return Response.json({details:{}});
   calls++;return Response.json(body,{status});
  };
  await assert.rejects(progressAgentModel({...request(provider),model:'unfamiliar-model'},'fixture-secret',new Set(['http://ollama:11434']),{fetcher}),error=>{
   assert.equal(error.category,category);assert.doesNotMatch(error.safeMessage,/private|fixture-secret/i);
   if(category==='provider_api_unsupported')assert.doesNotMatch(error.safeMessage,/Responses/);
   return true;
  });
  assert.equal(calls,1);
 }
});
test('invalid tool identity and uncorrelatable continuation never reach execution',async()=>{assert.throws(()=>validateConversation([{role:'tool',callId:'missing',name:'search',text:'x'}]));await assert.rejects(progressAgentModel(request('anthropic-messages'),'secret',new Set(),{fetcher:async()=>Response.json({type:'message',stop_reason:'tool_use',content:[{type:'tool_use',id:'same',name:'search',input:{}},{type:'tool_use',id:'same',name:'search',input:{}}]})}));await assert.rejects(progressAgentModel(request('anthropic-messages'),'secret',new Set(),{fetcher:async()=>Response.json({type:'message',stop_reason:'tool_use',content:[{type:'tool_use',id:'id',name:'ungranted',input:{}}]})}),{category:'permission_denied'})});
const verdict={eventId:'event',sessionId:'session',madCode:'',policy:{mode:3,policyM0:false,policyM2:false,policyM3:false,policyM4:false},hitl:null};
for(const provider of ['openai-agents','anthropic-messages','ollama-chat'])test(`${provider} journal reconstructs Adrian exact-call enforcement after process replacement`,async()=>{for(const outcome of ['allow','deny','unavailable','throw','alert']){const events=[],handler={handleChatModelStart:async(...args)=>events.push(['context',...args]),handleLLMEnd:async data=>events.push(['proposal',data]),handleToolStart:async(...args)=>events.push(['tool',...args]),handleToolError:async()=>{}},client={loginAcked:()=>true,policyActive:()=>true,blockTimeout:()=>outcome==='alert'?0:0.25,waitForToolCallVerdict:async id=>{assert.equal(id,'exact-call');if(outcome==='throw')throw Error('timeout');return outcome==='allow'?verdict:outcome==='deny'?{...verdict,madCode:'M0',policy:{...verdict.policy,policyM0:true}}:null}},context={model:provider,instructions:'context',conversation:[{role:'user',text:'request'}],call:{id:'exact-call',name:'search',arguments:{query:'safe'}},id:'invocation'};const work=authorizeJournaledTool(handler,client,context,250);if(outcome==='allow'){assert.deepEqual(await work,{outcome:'allow'});assert.deepEqual(events.map(e=>e[0]),['context','proposal','tool']);assert.equal(events[1][1].toolCalls[0].id,'exact-call')}else await assert.rejects(work)}});
test('tool result sanitization removes credential fields and exact credential echoes without rewriting safe content',async()=>{const{sanitizeToolResult}=await import('../dist/agent-contract.js');assert.deepEqual(sanitizeToolResult({content:[{type:'text',text:'echo credential-value; useful result'}],authorization:'Bearer credential-value',nested:{apiKey:'other'}},'credential-value'),{content:[{type:'text',text:'echo [redacted]; useful result'}],authorization:'[redacted]',nested:{apiKey:'[redacted]'}})});

for(const provider of ['openai-agents','anthropic-messages','ollama-chat'])test(`${provider} fixture preserves two calls to the same tool and ordered correlated results`,async()=>{
 let turns=0,last;const fetcher=async(url,init)=>{const body=JSON.parse(init.body);if(String(url).endsWith('/api/show'))return Response.json({capabilities:['tools']});last=body;const first=++turns===1;
  if(provider==='openai-agents')return Response.json({id:`chat-${turns}`,object:'chat.completion',created:1,model:'gpt-4.1',choices:[{index:0,finish_reason:first?'tool_calls':'stop',message:first?{role:'assistant',content:null,tool_calls:[0,1].map(i=>({id:`call-${i}`,type:'function',function:{name:'search',arguments:JSON.stringify({query:`query-${i}`})}}))}:{role:'assistant',content:'done'}}]});
  if(provider==='anthropic-messages')return Response.json({type:'message',stop_reason:first?'tool_use':'end_turn',content:first?[0,1].map(i=>({type:'tool_use',id:`call-${i}`,name:'search',input:{query:`query-${i}`}})):[{type:'text',text:'done'}]});
  return Response.json({done:true,message:{role:'assistant',content:first?'':'done',...(first?{tool_calls:[0,1].map(i=>({function:{name:'search',arguments:{query:`query-${i}`}}}))}:{})}});
 };
 const input=request(provider),first=await progressAgentModel(input,'model-secret',new Set(['http://ollama:11434']),{fetcher});assert.equal(first.calls.length,2);assert.notEqual(first.calls[0].id,first.calls[1].id);
 const results=first.calls.map((call,i)=>({role:'tool',callId:call.id,name:call.name,text:`result-${i}`}));
 const next=await progressAgentModel({...input,turn:2,conversation:[...input.conversation,{role:'assistant',text:first.text,calls:first.calls},...results]},'model-secret',new Set(['http://ollama:11434']),{fetcher});assert.equal(next.text,'done');
 if(provider==='openai-agents'){assert.deepEqual(last.messages.slice(-2).map(m=>m.tool_call_id),first.calls.map(c=>c.id));assert.deepEqual(last.messages.slice(-2).map(m=>m.content),['result-0','result-1'])}
 else if(provider==='anthropic-messages'){assert.deepEqual(last.messages.at(-1).content.map(c=>c.tool_use_id),first.calls.map(c=>c.id));assert.deepEqual(last.messages.at(-1).content.map(c=>c.content),['result-0','result-1'])}
 else{assert.deepEqual(last.messages.slice(-2).map(m=>m.tool_name),['search','search']);assert.deepEqual(last.messages.slice(-2).map(m=>m.content),['result-0','result-1'])}
});
