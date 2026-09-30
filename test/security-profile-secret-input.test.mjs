import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import renderer from "react-test-renderer";
import {installTsxHook} from "./render-tsx.mjs";
const requireTsx=installTsxHook();
const {SecretDraftInput}=requireTsx("../components/SecretDraftInput.tsx");

test("API-key draft eye control reveals and hides without changing or submitting the value",async()=>{
  let tree;
  await renderer.act(async()=>{tree=renderer.create(React.createElement(SecretDraftInput,{name:"apiKey",required:true,defaultValue:"browser-only-secret"}))});
  const input=()=>tree.root.findByType("input"),button=()=>tree.root.findByType("button");
  assert.equal(input().props.type,"password");
  assert.equal(input().props.defaultValue,"browser-only-secret");
  assert.deepEqual({type:button().props.type,label:button().props["aria-label"],pressed:button().props["aria-pressed"]},{type:"button",label:"Show API key",pressed:false});
  assert.equal(tree.root.findAllByType("svg").length,1);
  await renderer.act(async()=>button().props.onClick());
  assert.equal(input().props.type,"text");
  assert.equal(input().props.defaultValue,"browser-only-secret");
  assert.deepEqual({type:button().props.type,label:button().props["aria-label"],pressed:button().props["aria-pressed"]},{type:"button",label:"Hide API key",pressed:true});
  await renderer.act(async()=>button().props.onClick());
  assert.equal(input().props.type,"password");
  assert.equal(input().props.defaultValue,"browser-only-secret");
  assert.equal(tree.root.findAllByType("form").length,0);
  await renderer.act(async()=>tree.unmount());
});
