import test from 'node:test';
import assert from 'node:assert/strict';
import {policyFixture} from './helpers/mcp-policy-fixture.mjs';
import {createMcpServer,discoverMcpServer,updateMcpServer,safeVersionedMcp} from '../lib/mcp-tool-service.ts';
import {installTsxHook} from './render-tsx.mjs';
const require=installTsxHook(),Module=require('node:module'),original=Module._load;let context;
Module._load=function(request,...rest){if(request==='@/lib/auth')return{requireApiRepositoryAccess:async()=>context.authorized?{access:{repositoryId:101},session:{login:context.actor}}:new Response(null,{status:401})};if(request==='@/lib/workflow-services')return{createToolDefinitionRepository:()=>context.f.repo,getProviderCredentialVault:async()=>context.f.vault,getMcpPolicyContext:async actor=>context.f.context(actor),safePolicyMcp:async(r,value)=>({...safeVersionedMcp(value),policyAuthority:await context.f.authority.inspect(r,value.definition,context.f.vault)})};return original.call(this,request,...rest)};
let item,collection,discovery;try{item=require('../app/api/tools/mcp/[id]/route.ts');collection=require('../app/api/tools/mcp/route.ts');discovery=require('../app/api/tools/mcp/[id]/discover/route.ts')}finally{Module._load=original}
const request=(method,body)=>new Request('https://adt.example/api/tools/mcp/docs',{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('MCP API rejects indirect denial removal and direct changes before any mutation, while permitting metadata edits',async t=>{
 const f=await policyFixture(t),input={id:'docs',name:'Docs',endpointUrl:'https://tools.example/mcp',authenticationMode:'none'};let saved=await createMcpServer(101,input,f.repo,f.vault,f.context('member'));saved=await discoverMcpServer(101,'docs',saved.fileSha,f.repo,f.vault,{discoverMcp:async()=>[{name:'search',inputSchema:{type:'object'}}]},f.context('member'));saved=await updateMcpServer(101,{...input,fileSha:saved.fileSha,toolPolicies:{search:{minimum:'deny'}}},f.repo,f.vault,f.context());context={f,actor:'member',authorized:true};const params={params:Promise.resolve({id:'docs'})},before=structuredClone(saved);
 for(const change of [{endpointUrl:'https://other.example/mcp'},{authenticationMode:'bearer',bearerToken:'must-not-be-created'},{toolPolicies:{}}])assert.equal((await item.PUT(request('PUT',{definition:{...input,...change},fileSha:saved.fileSha}),params)).status,403);
 assert.equal((await item.DELETE(request('DELETE',{fileSha:saved.fileSha}),params)).status,403);assert.deepEqual(await f.repo.get('docs'),before);assert.equal(f.vault.values.size,0);
 const renamed=await item.PUT(request('PUT',{definition:{...input,name:'Renamed'},fileSha:saved.fileSha}),params);assert.equal(renamed.status,200);const body=await renamed.json();assert.equal(body.policyAuthority.verified,true);assert.equal(body.definition.toolPolicies.search.minimum,'deny');
 context.actor='admin';const cleared=await item.PUT(request('PUT',{definition:{...input,toolPolicies:{}},fileSha:body.fileSha}),params);assert.equal(cleared.status,200);assert.equal((await cleared.json()).policyAuthority.verified,true);
 context.authorized=false;assert.equal((await collection.GET(new Request('https://adt.example'))).status,401);assert.equal((await discovery.POST(request('POST',{fileSha:'stale'}),params)).status,401);
});
