import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
import protobuf from 'protobufjs';
import {Agent,Runner} from '@openai/agents';
import {ScriptedModel,assistantMessage,functionCall} from '@openai/agents/testing';
import {gateToolCallIds,protoSource} from '@secureagentics/adrian';
import {AdrianRuntimeIntegration} from '../dist/adrian.js';
import {executeOpenAIAgents} from '../dist/openai-agents.js';

const request={protocolVersion:'adt-runtime-v1',capability:'openai-agents',requestId:'request',idempotencyKey:'run-1:step:1:1',agentName:'Agent',instructions:'Use tools safely.',input:'Find design guidance.',model:'gpt-test',options:{},tools:['artifact_search'],toolGateway:{url:'https://adt.example/tool',authority:'worker-authority'},mcpTools:[],credential:{version:1,keyId:'x',algorithm:'RSA-OAEP-256+A256GCM',wrappedKey:'x',nonce:'x',ciphertext:'x'}};
const collector=()=>{const events=[];return{events,handler:{onPairedEvent(event){events.push(event)},close(){}}}};

test('only Adrian core is installed in Runtime and no proxy call exists in Runtime source',async()=>{
 const runtimePackage=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')),rootPackage=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
 assert.equal(runtimePackage.dependencies['@secureagentics/adrian'],'1.1.0');assert.equal(runtimePackage.dependencies['@secureagentics/adrian-openai'],undefined);assert.equal(rootPackage.dependencies?.['@secureagentics/adrian'],undefined);assert.equal(rootPackage.devDependencies?.['@secureagentics/adrian'],undefined);
 const files=await readdir(new URL('../src/',import.meta.url),{recursive:true}),source=(await Promise.all(files.filter(file=>file.endsWith('.ts')).map(file=>readFile(new URL(`../src/${file}`,import.meta.url),'utf8')))).join('\n');assert.doesNotMatch(source,/adrian\.openai\s*\(/);assert.doesNotMatch(source,/@secureagentics\/adrian-openai/);
});

test('Adrian core captures model and tool pairs through ADT-owned public extension points without receiving credentials',async t=>{
 const seen=collector(),integration=await AdrianRuntimeIntegration.create({apiKey:null,wsUrl:null,sessionId:'adt-run-1',handlers:[seen.handler],verdictTimeoutSeconds:.02});t.after(()=>integration.shutdown());
 let gatewayCalls=0;
 const model=new ScriptedModel([[functionCall('artifact_search',{query:'design'},{callId:'provider-call-1'})],[assistantMessage('done')]]);
 const output=await executeOpenAIAgents(request,'provider-secret',{provider:()=>({getModel:async()=>model}),runner:c=>new Runner(c),agent:c=>new Agent(c),securityGate:integration,modelInstrumentation:integration,fetcher:async()=>{gatewayCalls++;return Response.json({results:[{body:'safe result'}]})}});
 assert.equal(output,'done');assert.equal(gatewayCalls,1);
 assert.equal(seen.events.filter(event=>event.pairType==='llm').length,2);
 const proposed=seen.events.find(event=>event.data.kind==='llm'&&event.data.toolCalls.length);
 assert.equal(proposed.runId,'run-1:step:1:1:turn:1');assert.equal(proposed.data.toolCalls[0].id,'provider-call-1');assert.equal(proposed.data.toolCalls[0].name,'artifact_search');
 const tool=seen.events.find(event=>event.pairType==='tool');assert.equal(tool.data.toolCallId,'provider-call-1');assert.equal(tool.data.toolName,'artifact_search');assert.match(tool.data.output,/safe result/);
 const credentialContext={name:'test_tool',arguments:{query:'safe',authorization:'argument-secret',credential:{token:'nested-secret'},vaultSecretId:'vault-id-secret',adtInternalAuthority:'internal-authority-secret',encryptedCredentialEnvelope:{ciphertext:'cipher-secret'}},callId:'credential-test'};await integration.authorize(credentialContext);await integration.completed(credentialContext,JSON.stringify({ok:true,apiKey:'result-secret'}));
 await integration.modelTurnStarted({turnId:'structured-turn',model:'gpt-test',request:{systemInstructions:'ordinary system content',input:[{type:'message',role:'user',content:{query:'ordinary structured input',authorization:'input-secret',credential:{token:'nested-input-secret'}}}],modelSettings:{},tools:[],outputType:'text',handoffs:[],tracing:'disabled'}});
 await integration.modelTurnCompleted({turnId:'structured-turn',model:'gpt-test',response:{usage:{inputTokens:1,outputTokens:1,totalTokens:2},output:[functionCall('test_tool',{query:'ordinary proposed argument',authorization:'proposed-secret',credential:{token:'nested-proposed-secret'}},{callId:'proposed-sensitive-call'})]}});
 await integration.modelTurnStarted({turnId:'model-error-turn',model:'gpt-test',request:{input:'ordinary error input',modelSettings:{},tools:[],outputType:'text',handoffs:[],tracing:'disabled'}});const modelError=Object.assign(new Error('model-error-secret'),{credential:{token:'nested-model-error-secret'}});await integration.modelTurnFailed({turnId:'model-error-turn',model:'gpt-test',error:modelError});
 const toolErrorContext={name:'test_tool',arguments:{query:'ordinary failing argument'},callId:'tool-error-call'};await integration.authorize(toolErrorContext);const toolError=Object.assign(new Error('tool-error-secret'),{authorization:'nested-tool-error-secret'});await integration.failed(toolErrorContext,toolError);
 const sensitiveProposal=seen.events.find(event=>event.data.kind==='llm'&&event.data.toolCalls.some(call=>call.id==='proposed-sensitive-call')),structured=seen.events.find(event=>event.runId==='structured-turn');assert.equal(sensitiveProposal.data.toolCalls[0].args.query,'ordinary proposed argument');assert.match(structured.data.messages.at(-1).content,/ordinary structured input/);
 const payload=JSON.stringify(seen.events);assert.match(payload,/ordinary system content|ordinary proposed argument|ordinary failing argument/);assert.doesNotMatch(payload,/provider-secret|worker-authority|argument-secret|nested-secret|vault-id-secret|internal-authority-secret|cipher-secret|result-secret|input-secret|nested-input-secret|proposed-secret|nested-proposed-secret|model-error-secret|nested-model-error-secret|tool-error-secret|nested-tool-error-secret/);
});

function backend(t,{verdict='allow',delayMs=0,disconnect=false}={}){
 const root=protobuf.parse(protoSource,{keepCase:true}).root,Client=root.lookupType('adrian.core_api.v1.ClientFrame'),Server=root.lookupType('adrian.core_api.v1.ServerFrame');
 const server=new WebSocketServer({host:'127.0.0.1',port:0});const frames=[];
 server.on('connection',socket=>socket.on('message',raw=>{const frame=Client.toObject(Client.decode(raw),{defaults:true});frames.push(frame);if(frame.login){socket.send(Server.encode(Server.create({login_ack:{policy:{mode:3,policy_m0:true,policy_m2:true,policy_m3:true,policy_m4:true}}})).finish());return}const event=frame.paired_batch?.events?.find(value=>value.llm?.tool_calls?.length);if(!event)return;if(disconnect){socket.close();return}if(verdict==='none')return;setTimeout(()=>socket.send(Server.encode(Server.create({verdict:{event_id:event.event_id,session_id:event.session_id,mad_code:verdict==='deny'?'M3.1':'M1.0',policy:{mode:3,policy_m0:true,policy_m2:true,policy_m3:true,policy_m4:true}}})).finish()),delayMs)}));
 t.after(()=>new Promise(resolve=>{for(const client of server.clients)client.terminate();server.close(resolve)}));return new Promise(resolve=>server.on('listening',()=>{const address=server.address();resolve({url:`ws://127.0.0.1:${address.port}`,frames})}));
}

async function executeWithBackend(t,behavior,{mcp=false,breakBlockReporting=false,breakCompletionReporting=false}={}){
 const remote=await backend(t,behavior),dir=await mkdtemp(join(tmpdir(),'adt-adrian-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const integration=await AdrianRuntimeIntegration.create({apiKey:'fixture-key',wsUrl:remote.url,sessionId:`session-${crypto.randomUUID()}`,logFile:join(dir,'events.jsonl'),blockTimeout:.04,verdictTimeoutSeconds:.04});t.after(()=>integration.shutdown());if(breakBlockReporting)integration.handler.handleToolError=async()=>{throw new Error('block reporting unavailable')};if(breakCompletionReporting)integration.handler.handleToolEnd=async()=>{throw new Error('completion reporting unavailable')};
 let executions=0;const toolName=mcp?'mcp_docs_search':'artifact_search',model=new ScriptedModel([[functionCall(toolName,mcp?{text:'design',authorization:'mcp-argument-secret',credential:{token:'nested-mcp-argument-secret'}}:{query:'design'},{callId:'call-verdict'})],[assistantMessage('finished')]]),executionRequest=mcp?{...request,tools:[],toolGateway:undefined,mcpTools:[{alias:toolName,serverId:'docs',server:{url:'http://localhost/mcp',transport:'streamable-http',allowLocalhost:true},tool:{name:'search',inputSchema:{type:'object'}}}]}:request;
 const fetcher=async(_url,init)=>{if(!mcp){executions++;return Response.json({results:[]})}const message=JSON.parse(init.body);if(message.method==='initialize')return Response.json({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}});if(message.method==='notifications/initialized')return new Response(null,{status:202});if(message.method==='tools/call'){executions++;return Response.json({jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:'committed once'}]}})}throw new Error('unexpected MCP request')};
 const output=await executeOpenAIAgents(executionRequest,'provider-secret',{provider:()=>({getModel:async()=>model}),runner:c=>new Runner(c),agent:c=>new Agent(c),securityGate:integration,modelInstrumentation:integration,mcpCredentials:new Map([[toolName,'mcp-private-token']]),fetcher});
 return{output,executions,remote,logFile:join(dir,'events.jsonl')};
}

test('real Adrian wire verdict blocks before the underlying tool side effect and allow executes exactly once',async t=>{
 await t.test('deny',async t=>{const result=await executeWithBackend(t,{verdict:'deny'});assert.equal(result.executions,0);assert.equal(result.output,'finished')});
 await t.test('allow',async t=>{const result=await executeWithBackend(t,{verdict:'allow'});assert.equal(result.executions,1);assert.equal(result.output,'finished')});
 await t.test('denied MCP call',async t=>{const result=await executeWithBackend(t,{verdict:'deny'},{mcp:true});assert.equal(result.executions,0);const log=await readFile(result.logFile,'utf8');assert.match(log,/design/);assert.doesNotMatch(log,/mcp-private-token|provider-secret|worker-authority|mcp-argument-secret|nested-mcp-argument-secret/)});
 await t.test('block reporting failure',async t=>{const result=await executeWithBackend(t,{verdict:'deny'},{breakBlockReporting:true});assert.equal(result.executions,0);assert.equal(result.output,'finished')});
 await t.test('completion reporting failure after MCP',async t=>{const result=await executeWithBackend(t,{verdict:'allow'},{mcp:true,breakCompletionReporting:true});assert.equal(result.executions,1);assert.equal(result.output,'finished')});
});

test('Adrian 1.1.0 core fail-opens identically for verdict timeout and backend disconnect',async t=>{
 await t.test('no verdict',async t=>{const result=await executeWithBackend(t,{verdict:'none'});assert.equal(result.executions,1)});
 await t.test('disconnect',async t=>{const result=await executeWithBackend(t,{disconnect:true});assert.equal(result.executions,1)});
});

test('public gate result cannot distinguish a missing verdict from an allow verdict',async()=>{
 const policy={waitForPolicyReady:async()=>true,policyActive:()=>true,blockTimeout:()=>.001,waitForToolCallVerdict:async()=>null};
 assert.deepEqual(await gateToolCallIds(['call'],policy,.001),{action:'allow'});
});
