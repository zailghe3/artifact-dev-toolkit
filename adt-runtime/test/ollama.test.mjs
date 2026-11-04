import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,webcrypto} from 'node:crypto';
import {createServer} from 'node:http';
import {normalizeOllamaBaseUrl,parseOllamaAllowedBaseUrls} from '../dist/ollama-configuration.js';
import {executeOllama,discoverOllamaModels,parseOllamaModels} from '../dist/ollama.js';
import {createRuntimeServer} from '../dist/server.js';
import {providerExecutionSchema,providerModelsSchema,PROTOCOL_VERSION,PROVIDER_EXECUTE_PATH,PROVIDER_MODELS_PATH,sha256,signature} from '../dist/protocol.js';

const configuration={baseUrl:'http://ollama:11434',authMode:'none'},allowed=new Set([configuration.baseUrl]),identity={protocolVersion:PROTOCOL_VERSION,capability:'ollama-chat',requestId:'request',idempotencyKey:'run:node:1:1',agentName:'Ollama',instructions:' exact system\n',input:'',model:'model:tag',configuration,options:{maxOutputTokens:21,executionTimeoutSeconds:300}};
const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),authSecret='r'.repeat(48);
const headers=(path,body,nonce=crypto.randomUUID())=>{const timestamp=String(Date.now()),digest=sha256(body);return{'x-adt-protocol':PROTOCOL_VERSION,'x-adt-timestamp':timestamp,'x-adt-nonce':nonce,'x-adt-content-sha256':digest,'x-adt-signature':signature(authSecret,'POST',path,timestamp,nonce,digest),'content-type':'application/json'}};
async function wrap(aad,clear='secret-sentinel'){
 const der=Buffer.from(keys.publicKey.replace(/-----[^-]+-----|\s/g,''),'base64'),key=await webcrypto.subtle.importKey('spki',der,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']),aes=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']),iv=webcrypto.getRandomValues(new Uint8Array(12));
 return{version:1,keyId:sha256(der),algorithm:'RSA-OAEP-256+A256GCM',wrappedKey:Buffer.from(await webcrypto.subtle.encrypt({name:'RSA-OAEP'},key,await webcrypto.subtle.exportKey('raw',aes))).toString('base64url'),nonce:Buffer.from(iv).toString('base64url'),ciphertext:Buffer.from(await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(aad)},aes,new TextEncoder().encode(clear))).toString('base64url')};
}
async function fixture(t,providerHttp={}){const events=[],runtime=await createRuntimeServer({host:'127.0.0.1',port:0,authSecret,privateKeyPem:keys.privateKey,revision:'test',ollamaAllowedBaseUrls:configuration.baseUrl,providerHttp,logger:event=>events.push(event)});await runtime.listen();t.after(()=>runtime.close());return{events,url:`http://127.0.0.1:${runtime.server.address().port}`,send(payload,path=PROVIDER_EXECUTE_PATH,signed){const body=JSON.stringify(payload);return fetch(this.url+path,{method:'POST',headers:signed??headers(path,body),body})}}}

test('shared URL rules canonicalize origins and reject endpoint authority/path tricks',()=>{
 assert.equal(normalizeOllamaBaseUrl('HTTP://Ollama:11434/'),configuration.baseUrl);
 assert.equal(normalizeOllamaBaseUrl('https://OLLAMA.com:443/'),'https://ollama.com');
 for(const bad of ['',undefined,'x'.repeat(2049),'ftp://ollama','http://a:b@ollama','http://@ollama','http://ollama?','http://ollama?q=x','http://ollama#','http://ollama/#fragment','http://ollama/api/chat','http://ollama/a/..','http://ollama//','http://ollama\\@other',' http://ollama','http://ollama\n'])assert.throws(()=>normalizeOllamaBaseUrl(bad));
 for(const value of ['http://ollama,','bad','http://ollama/path',Array(33).fill('http://ollama').join(',')])assert.throws(()=>parseOllamaAllowedBaseUrls(value),/ollama_allowlist_invalid/);
 assert.deepEqual([...parseOllamaAllowedBaseUrls('http://ollama:11434/, https://ollama.com/')],[configuration.baseUrl,'https://ollama.com']);
});

test('exact operator endpoint match is required before either network operation',async()=>{
 let calls=0;const dependencies={fetcher:async()=>{calls++;throw Error('must not connect')}};
 for(const baseUrl of ['http://ollama:11435','https://ollama:11434','http://ollama.evil:11434','http://192.168.1.20:11434','http://other'])for(const operation of ['chat','models']){
  const safe={baseUrl,authMode:'none'};
  await assert.rejects(operation==='chat'?executeOllama({...identity,configuration:safe},'',allowed,dependencies):discoverOllamaModels(safe,'',allowed,dependencies),error=>error.category==='configuration_invalid');
 }
 assert.equal(calls,0);
});

test('native chat preserves prompt and empty input, positive generation bound and bearer policy',async()=>{
 for(const authMode of ['none','bearer']){let calls=0;const credential=authMode==='bearer'?'secret-sentinel':'',safe={...configuration,authMode};
  const output=await executeOllama({...identity,configuration:safe},credential,allowed,{fetcher:async(url,init)=>{
   calls++;assert.equal(url,configuration.baseUrl+'/api/chat');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,credential?'Bearer '+credential:undefined);
   assert.deepEqual(JSON.parse(init.body),{model:'model:tag',messages:[{role:'system',content:identity.instructions},{role:'user',content:''}],stream:false,options:{num_predict:21}});
   return Response.json({message:{content:'only output',thinking:'private thinking'},total_duration:10});
  }});assert.equal(output,'only output');assert.equal(calls,1);
 }
});

test('execution and discovery schemas enforce provider-only fields and explicit credential modes',async()=>{
 const envelope=await wrap('unused');
 for(const authMode of ['none','bearer']){
  const valid={...identity,configuration:{...configuration,authMode},...(authMode==='bearer'?{credential:envelope}:{})};assert.equal(providerExecutionSchema.safeParse(valid).success,true);
  for(const extra of [{tools:[]},{mcpTools:[]},{runtimeSecurity:{}},{executionTimeoutMs:1000},{options:{temperature:1}},{configuration:{...valid.configuration,apiKey:'secret'}},{credential:authMode==='none'?envelope:undefined}])assert.equal(providerExecutionSchema.safeParse({...valid,...extra}).success,false);
  const discovery={protocolVersion:PROTOCOL_VERSION,capability:'provider-model-discovery',provider:'ollama-chat',requestId:'request',configuration:valid.configuration,...(valid.credential?{credential:valid.credential}:{})};assert.equal(providerModelsSchema.safeParse(discovery).success,true);
  for(const extra of [{input:''},{instructions:'prompt'},{tools:[]},{repositoryContext:{}},{model:'x'},{credential:authMode==='none'?envelope:undefined}])assert.equal(providerModelsSchema.safeParse({...discovery,...extra}).success,false);
 }
 for(const options of [{maxOutputTokens:0},{maxOutputTokens:32769},{executionTimeoutSeconds:4},{executionTimeoutSeconds:901}])assert.equal(providerExecutionSchema.safeParse({...identity,options}).success,false);
 assert.deepEqual(providerExecutionSchema.parse({...identity,options:{}}).options,{maxOutputTokens:4096,executionTimeoutSeconds:300});
});

test('model discovery uses only tags, deterministic bounded canonical identifiers and safe failure categories',async()=>{
 for(const authMode of ['none','bearer']){
  const models=await discoverOllamaModels({...configuration,authMode},authMode==='bearer'?'key':'',allowed,{fetcher:async(url,init)=>{assert.equal(url,configuration.baseUrl+'/api/tags');assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,authMode==='bearer'?'Bearer key':undefined);return Response.json({models:[{name:'alias',model:'z:latest'},{model:'a'},{model:'z:latest'}]})}});assert.deepEqual(models,['a','z:latest']);
 }
 for(const bad of [null,{},[],{models:{}},{models:Array(257).fill({model:'ok'})},{models:[{name:'only-alias'}]},{models:[{model:''}]},{models:[{model:'x'.repeat(121)}]},{models:[{model:'has\nnewline'}]}])assert.throws(()=>parseOllamaModels(bad),error=>error.category==='malformed_response');
 for(const [status,category] of [[401,'authentication_failed'],[403,'permission_denied'],[429,'rate_limited'],[500,'provider_unavailable'],[302,'provider_rejected']])await assert.rejects(discoverOllamaModels(configuration,'',allowed,{fetcher:async()=>new Response('private body secret',{status})}),error=>error.category===category&&!error.safeMessage.includes('secret'));
 await assert.rejects(discoverOllamaModels(configuration,'',allowed,{fetcher:async()=>{throw Error('private network')}}),error=>error.category==='provider_unavailable');
 await assert.rejects(discoverOllamaModels(configuration,'',allowed,{timeoutMs:5,fetcher:async()=>new Promise(()=>{})}),error=>error.category==='provider_timeout');
});

test('Runtime authenticates, replay-protects, validates AAD and never enters the provider on denied input',async t=>{
 let calls=0;const f=await fixture(t,{fetcher:async(url)=>{calls++;return url.endsWith('/api/tags')?Response.json({models:[{model:'model:tag'}]}):Response.json({message:{content:'done'}})}});
 const discovery={protocolVersion:PROTOCOL_VERSION,capability:'provider-model-discovery',provider:'ollama-chat',requestId:'discovery',configuration};
 assert.equal((await f.send(discovery,PROVIDER_MODELS_PATH,{})).status,401);
 const signed=headers(PROVIDER_MODELS_PATH,JSON.stringify(discovery));assert.equal((await f.send(discovery,PROVIDER_MODELS_PATH,signed)).status,200);assert.equal((await f.send(discovery,PROVIDER_MODELS_PATH,signed)).status,401);
 for(const path of [PROVIDER_EXECUTE_PATH,PROVIDER_MODELS_PATH]){
  const base=path===PROVIDER_EXECUTE_PATH?identity:discovery,aad=path===PROVIDER_EXECUTE_PATH?`${PROTOCOL_VERSION}:ollama-chat:${identity.idempotencyKey}`:`${PROTOCOL_VERSION}:provider-model-discovery:ollama-chat:${discovery.requestId}`,credential=await wrap(aad);
  const valid={...base,configuration:{...configuration,authMode:'bearer'},credential};
  assert.equal((await f.send(valid,path)).status,200);
  for(const bad of [{...valid,credential:await wrap(aad+':wrong')},{...valid,credential:{...credential,keyId:'wrong'}},{...valid,configuration:{...valid.configuration,baseUrl:'http://not-approved'}}]){
   const before=calls,response=await f.send(bad,path),wire=await response.json();assert.ok(response.status>=400);assert.equal(wire.error.providerExecutionEntered,false);assert.equal(calls,before);assert.doesNotMatch(JSON.stringify(wire),/secret-sentinel|not-approved|ciphertext|wrappedKey/);
  }
 }
 assert.doesNotMatch(JSON.stringify(f.events),/ollama:11434|secret-sentinel|ciphertext|wrappedKey|exact system/);
 const readyBody='',timestamp=String(Date.now()),nonce=crypto.randomUUID(),digest=sha256(readyBody),ready=await fetch(f.url+'/v1/readiness',{headers:{'x-adt-protocol':PROTOCOL_VERSION,'x-adt-timestamp':timestamp,'x-adt-nonce':nonce,'x-adt-content-sha256':digest,'x-adt-signature':signature(authSecret,'GET','/v1/readiness',timestamp,nonce,digest)}}),wire=await ready.json();
 assert.ok(['provider-execution','ollama-chat','provider-model-discovery','openai-agents','anthropic-messages','work-iq-rest'].every(value=>wire.capabilities.includes(value)));assert.doesNotMatch(JSON.stringify(wire),/ollama:11434|allowedBase/);
});

test('malformed allowlist rejects server creation instead of ignoring entries',async()=>{await assert.rejects(createRuntimeServer({host:'127.0.0.1',port:0,authSecret,privateKeyPem:keys.privateKey,revision:'test',ollamaAllowedBaseUrls:'http://ok,invalid'}),/ollama_allowlist_invalid/)});

test('chat never retries uncertain dispatch and bounds malformed or excessive provider output',async()=>{
 for(const [respond,category] of [[async()=>{throw Error('private')},'provider_start_ambiguous'],[async()=>new Promise(()=>{}),'provider_start_ambiguous'],[async()=>Response.json({message:{content:'é'.repeat(131073)}}),'output_too_large'],[async()=>Response.json({message:{thinking:'hidden'}}),'malformed_response'],[async()=>new Response('x'.repeat(1100001)),'output_too_large']]){
  let calls=0,entered=0;await assert.rejects(executeOllama(identity,'',allowed,{timeoutMs:10,onProviderEntry:()=>entered++,fetcher:async()=>{calls++;return respond()}}),error=>error.category===category);assert.equal(calls,1);assert.equal(entered,1);
 }
 await assert.rejects(discoverOllamaModels(configuration,'',allowed,{fetcher:async()=>new Response('x'.repeat(1100001))}),error=>error.category==='output_too_large');
});

test('real allowed private HTTP origin cannot redirect chat or discovery to another destination',async t=>{
 let redirected=0;const target=createServer((_req,res)=>{redirected++;res.end('{}')});await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>target.close(resolve)));
 const redirect=createServer((_req,res)=>{res.writeHead(307,{location:`http://127.0.0.1:${target.address().port}/private`});res.end()});await new Promise(resolve=>redirect.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>redirect.close(resolve)));
 const safe={baseUrl:`http://127.0.0.1:${redirect.address().port}`,authMode:'none'},endpoints=new Set([safe.baseUrl]);
 await assert.rejects(executeOllama({...identity,configuration:safe},'',endpoints),error=>error.category==='provider_start_ambiguous');
 await assert.rejects(discoverOllamaModels(safe,'',endpoints),error=>error.category==='provider_unavailable');assert.equal(redirected,0);
});

test('explicitly approved LAN HTTP and authenticated HTTPS origins work for both owned paths',async()=>{
 for(const [baseUrl,authMode] of [['http://192.168.1.20:11434','none'],['https://ollama.internal.example','bearer']]){
  const safe={baseUrl,authMode},endpoints=new Set([baseUrl]),calls=[],credential=authMode==='bearer'?'key':'';
  const dependencies={fetcher:async(url,init)=>{calls.push(url);assert.equal(init.headers.authorization,credential?'Bearer key':undefined);return url.endsWith('/api/tags')?Response.json({models:[{model:'model:tag'}]}):Response.json({message:{content:'output'}})}};
  assert.deepEqual(await discoverOllamaModels(safe,credential,endpoints,dependencies),['model:tag']);assert.equal(await executeOllama({...identity,configuration:safe},credential,endpoints,dependencies),'output');assert.deepEqual(calls,[baseUrl+'/api/tags',baseUrl+'/api/chat']);
 }
});
