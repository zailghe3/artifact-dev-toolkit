import test from 'node:test';
import assert from 'node:assert/strict';
import {installTsxHook} from './render-tsx.mjs';
import {ProviderModelService} from '../lib/provider-model-service.ts';

const require=installTsxHook(),Module=require('node:module'),originalLoad=Module._load;
let context;
const services={
 getProviderModelService:async()=>context.models,
 getWorkflowProviderConnectionStore:async()=>context.store,
 getProviderCredentialVault:async()=>context.vault,
 createWorkflowConnectionDefinitionRepository:()=>context.repository,
};
Module._load=function(request,...rest){
 if(request==='@/lib/auth')return{requireApiRepositoryAccess:async()=>context.authorized?{access:{}}:new Response(null,{status:403})};
 if(request==='@/lib/workflow-services')return services;
 return originalLoad.call(this,request,...rest);
};
let create,update,credential,discover;
try{create=require('../app/api/workflow-connections/route.ts');update=require('../app/api/workflow-connections/[connectionKey]/route.ts');credential=require('../app/api/workflow-connections/[connectionKey]/credential/route.ts');discover=require('../app/api/workflow-connections/models/route.ts')}finally{Module._load=originalLoad}
const configuration={baseUrl:'http://ollama:11434',authMode:'none'},secretRef=`sec_${'a'.repeat(43)}`,params={params:Promise.resolve({connectionKey:'ollama'})};
const request=(body,method='POST',origin='https://adt.example')=>new Request('https://adt.example/api/workflow-connections',{method,headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
function fixture(){
 const calls=[],saved={value:undefined},descriptor=()=>saved.value?{key:'ollama',name:saved.value.name,adapter:'ollama-chat',enabled:true,configured:true,defaultModel:saved.value.model,providerConfiguration:saved.value.configuration,management:'git',repositoryRevision:'sha',...(saved.value.credential?{credentialSource:'adt-vault',credentialSecretRef:secretRef}:{}),capabilities:{asynchronous:false,cancellation:false}}:undefined;
 context={authorized:true,calls,saved,models:new ProviderModelService({listRuntimeModels:async(safe,key)=>{calls.push(['models',safe,key]);return['first','second']}}),store:{getSafeDescriptor:async()=>descriptor(),resolveForExecution:async(_key,snapshot)=>{calls.push(['resolve',snapshot]);return{...(snapshot??descriptor()),...(saved.value.credential?{credential:'vault-only-key'}:{})}}},vault:{create:async key=>{calls.push(['vault-create',key]);return secretRef},delete:async()=>calls.push(['vault-delete']),replace:async(ref,key)=>calls.push(['replace',ref,key])},repository:{getConnection:async()=>saved.value?{definition:saved.value,fileSha:'sha',sourcePath:'connections/ollama.connection.json'}:undefined,createConnection:async definition=>{calls.push(['git-create',definition]);saved.value=definition},updateConnection:async(definition,sha)=>{assert.equal(sha,'sha');calls.push(['git-update',definition]);saved.value=definition}}};return context;
}

test('actual Ollama creation and update routes enforce auth, immutable endpoint identity, discovered models, and vault policy',async()=>{
 for(const authMode of ['none','bearer']){
  const f=fixture(),body={connectionKey:'ollama',displayName:'Ollama',adapter:'ollama-chat',model:'first',configuration:{...configuration,authMode},...(authMode==='bearer'?{credential:'browser-only-key'}:{})};
  f.authorized=false;assert.equal((await create.POST(request(body))).status,403);assert.deepEqual(f.calls,[]);f.authorized=true;
  assert.equal((await create.POST(request(body,'POST','https://other.example'))).status,403);assert.deepEqual(f.calls,[]);
  const created=await create.POST(request(body));assert.equal(created.status,201);assert.equal(f.calls.filter(call=>call[0]==='vault-create').length,authMode==='bearer'?1:0);assert.equal(f.calls[0][0],'models');assert.doesNotMatch(JSON.stringify(f.saved.value),/browser-only-key|vault-only-key/);assert.doesNotMatch(await created.text(),/browser-only-key|vault-only-key/);
  for(const changed of [{baseUrl:'http://other',authMode},{...configuration,authMode:authMode==='none'?'bearer':'none'}]){f.calls.length=0;const response=await update.PUT(request({displayName:'Name',model:'second',configuration:changed,repositoryRevision:'sha'},'PUT'),params);assert.equal(response.status,409);assert.equal((await response.json()).code,'connection_configuration_immutable');assert.deepEqual(f.calls,[])}
  f.calls.length=0;const missing=await update.PUT(request({displayName:'Name',model:'missing',repositoryRevision:'sha'},'PUT'),params);assert.equal(missing.status,422);assert.equal(f.calls.some(call=>call[0]==='git-update'),false);
  f.calls.length=0;assert.equal((await update.PUT(request({displayName:'Changed',model:'second',repositoryRevision:'sha'},'PUT'),params)).status,200);assert.equal(f.saved.value.name,'Changed');assert.equal(f.saved.value.model,'second');assert.deepEqual(f.saved.value.configuration,{...configuration,authMode});assert.equal(f.calls[0][0],'resolve');assert.equal(f.calls[0][1].credentialSecretRef,authMode==='bearer'?secretRef:undefined);
  f.calls.length=0;const rotation=await credential.PUT(request({credential:'rotated-key',repositoryRevision:'sha'},'PUT'),params);assert.equal(rotation.status,authMode==='bearer'?200:422);assert.deepEqual(f.calls,authMode==='bearer'?[['replace',secretRef,'rotated-key']]:[]);
 }
});

test('unsaved direct-cloud discovery and creation reject no-auth before commissioning or persistence',async()=>{
 for(const baseUrl of ['https://ollama.com','HTTPS://OLLAMA.COM:443/']){
  const f=fixture(),configuration={baseUrl,authMode:'none'};
  assert.equal((await discover.POST(request({connectionType:'ollama-chat',configuration}))).status,422);
  assert.equal((await create.POST(request({connectionKey:'ollama',displayName:'Cloud',adapter:'ollama-chat',model:'first',configuration}))).status,422);
  assert.deepEqual(f.calls,[]);assert.equal(f.saved.value,undefined);
 }
});
