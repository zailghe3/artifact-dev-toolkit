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

test("failed Test feedback exposes only the bounded commissioning boundary and HTTP status",async()=>{
 assert.deepEqual(securityTestFailureFeedback({error:"Adrian WebSocket access was forbidden by the hosted service. (HTTP 403)",stage:"upgrade",httpStatus:403}),{message:"Adrian WebSocket access was forbidden by the hosted service. (HTTP 403)",detail:"WSS upgrade: HTTP 403"});
 const previousFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:"Adrian authentication failed. The configured API key was rejected. (HTTP 401)",stage:"upgrade",httpStatus:401},{status:503});let tree;
 try{await renderer.act(async()=>{tree=renderer.create(React.createElement(SecurityProfileActions,{id:"hosted",fileSha:"sha"}))});const testButton=tree.root.findAllByType("button").find(button=>button.children.includes("Test"));await renderer.act(async()=>testButton.props.onClick());const copy=text(tree);assert.match(copy,/WSS upgrade: HTTP 401/);assert.match(copy,/configured API key was rejected/)}finally{globalThis.fetch=previousFetch;if(tree)await renderer.act(async()=>tree.unmount())}
});
