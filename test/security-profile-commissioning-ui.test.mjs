import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import renderer from "react-test-renderer";
import {createRequire} from "node:module";
import {installTsxHook} from "./render-tsx.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const require=createRequire(import.meta.url),navigationPath=require.resolve("next/navigation"),originalNavigation=require.cache[navigationPath];
require.cache[navigationPath]={id:navigationPath,filename:navigationPath,loaded:true,exports:{useRouter:()=>({push(){},refresh(){}})},children:[],paths:[]};
const requireTsx=installTsxHook(),{SecurityProfileEditor,ADRIAN_CLOUD_ENDPOINT}=requireTsx("../components/SecurityProfileEditor.tsx"),{SecurityProfileActions,securityTestFailureFeedback}=requireTsx("../components/SecurityProfileActions.tsx");
if(originalNavigation)require.cache[navigationPath]=originalNavigation;else delete require.cache[navigationPath];

const text=value=>JSON.stringify(value.toJSON());
test("new Security Profiles default to Adrian Cloud while keeping the endpoint editable and explaining hosted credentials",async()=>{
 let tree;await renderer.act(async()=>{tree=renderer.create(React.createElement(SecurityProfileEditor,{}))});
 const endpoint=tree.root.findAllByType("input").find(input=>input.props.name==="endpointUrl");
 assert.equal(endpoint.props.defaultValue,"wss://adrian.secureagentics.ai/ws");assert.equal(endpoint.props.readOnly,undefined);assert.equal(ADRIAN_CLOUD_ENDPOINT,endpoint.props.defaultValue);
 const copy=text(tree);assert.match(copy,/Adrian Cloud endpoint/);assert.match(copy,/adr_live_\.\.\./);assert.match(copy,/Adrian agent profile/);assert.match(copy,/Custom secure WSS endpoints remain supported/);
 await renderer.act(async()=>tree.unmount());
});

test("existing Security Profiles preserve their stored custom endpoint",async()=>{
 const initial={id:"custom",name:"Custom",description:"",endpointUrl:"wss://self-hosted.example/control",decisionTimeoutMs:1000,credentialConfigured:true};let tree;
 await renderer.act(async()=>{tree=renderer.create(React.createElement(SecurityProfileEditor,{initial,fileSha:"sha"}))});
 const endpoint=tree.root.findAllByType("input").find(input=>input.props.name==="endpointUrl");assert.equal(endpoint.props.defaultValue,initial.endpointUrl);assert.equal(endpoint.props.readOnly,undefined);assert.doesNotMatch(text(tree),/adr_live_/);
 await renderer.act(async()=>tree.unmount());
});

async function renderAction(response,buttonLabel="Test"){
 const previousFetch=globalThis.fetch;globalThis.fetch=async()=>response;let tree;
 try{await renderer.act(async()=>{tree=renderer.create(React.createElement(SecurityProfileActions,{id:"profile",fileSha:"sha"}))});const button=tree.root.findAllByType("button").find(item=>item.children.includes(buttonLabel));await renderer.act(async()=>button.props.onClick());return tree}finally{globalThis.fetch=previousFetch}
}

test("failed Test feedback exposes only the bounded commissioning boundary and is always an error",async()=>{
 assert.deepEqual(securityTestFailureFeedback({error:"Adrian WebSocket access was forbidden. (HTTP 403)",stage:"upgrade",httpStatus:403}),{kind:"error",message:"Adrian WebSocket access was forbidden. (HTTP 403)",detail:"WSS upgrade: HTTP 403"});
 const failures=[
  {error:"Adrian authentication failed. The configured API key was rejected. (HTTP 401)",stage:"upgrade",httpStatus:401,expected:/configured API key was rejected/},
  {error:"Adrian WebSocket access was forbidden. (HTTP 403)",stage:"upgrade",httpStatus:403,expected:/access was forbidden/},
  {error:"Adrian authentication and policy login succeeded, but the ADT Runtime Adrian SDK did not become ready.",stage:"sdk",expected:/did not become ready/},
 ];
 for(const failure of failures){const tree=await renderAction(Response.json(failure,{status:503}));try{const feedback=tree.root.findAllByType("p").find(item=>item.props.id==="security-action-feedback");assert.equal(feedback.props.role,"alert");assert.match(text(tree),failure.expected);if(failure.httpStatus)assert.match(text(tree),new RegExp(`WSS upgrade: HTTP ${failure.httpStatus}`))}finally{await renderer.act(async()=>tree.unmount())}}
});

test("successful Test feedback uses explicit success presentation and endpoint-neutral wording",async()=>{
 const tree=await renderAction(Response.json({state:"ready"}));try{const feedback=tree.root.findAllByType("p").find(item=>item.props.id==="security-action-feedback"),copy=text(tree);assert.equal(feedback.props.role,"status");assert.match(copy,/Adrian security is ready\. Authentication succeeded and Block policy is active\./);assert.doesNotMatch(copy,/SaaS|hosted/i)}finally{await renderer.act(async()=>tree.unmount())}
});

test("failed delete feedback is rendered as an error",async()=>{
 const tree=await renderAction(Response.json({error:"Delete failed safely."},{status:503}),"Delete");try{assert.equal(tree.root.findAllByType("p").find(item=>item.props.id==="security-action-feedback").props.role,"alert")}finally{await renderer.act(async()=>tree.unmount())}
});
