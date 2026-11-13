import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {installTsxHook} from './render-tsx.mjs';
const require=installTsxHook(),{McpServerEditor}=require('../components/McpServerEditor.tsx'),{AppRouterContext}=require('next/dist/shared/lib/app-router-context.shared-runtime');
for(const admin of [false,true])test(`MCP editor ${admin?'explicitly reauthorizes unverified policy':'preserves policies on ordinary metadata save'}`,async t=>{
 const prior={fetch:globalThis.fetch,form:globalThis.FormData,act:globalThis.IS_REACT_ACT_ENVIRONMENT};globalThis.IS_REACT_ACT_ENVIRONMENT=true;let tree,sent;
 const policies={search:{classification:'read_only',minimum:'deny',expirySeconds:86400}},initial={schemaVersion:1,id:'docs',name:'Docs',type:'mcp',transport:'streamable-http',endpointUrl:'https://tools.example/mcp',authentication:{mode:'none',credentialConfigured:false},toolPolicies:policies};
 globalThis.FormData=function(){return{get:key=>({id:'docs',name:'Renamed',endpointUrl:initial.endpointUrl,authenticationMode:'none',toolPolicies:JSON.stringify(admin?policies:{})})[key]}};
 globalThis.fetch=async(_url,init)=>{sent=JSON.parse(init.body);return Response.json({})};
 t.after(async()=>{await act(async()=>tree?.unmount());globalThis.fetch=prior.fetch;globalThis.FormData=prior.form;globalThis.IS_REACT_ACT_ENVIRONMENT=prior.act});
 await act(async()=>{tree=create(React.createElement(AppRouterContext.Provider,{value:{push(){},refresh(){}}},React.createElement(McpServerEditor,{initial,fileSha:'sha',canManagePolicies:admin,policyVerified:!admin})))});
 assert.equal(tree.root.findByType('textarea').props.readOnly,!admin);await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:{}})});
 assert.equal(sent.definition.name,'Renamed');if(admin)assert.deepEqual(sent.definition.toolPolicies,policies);else assert.equal('toolPolicies' in sent.definition,false);
});
