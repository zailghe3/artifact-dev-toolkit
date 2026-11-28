import test from "node:test";
import assert from "node:assert/strict";
import {acquireAdrianExecutionLease,evaluateAdrianToolCall,SecurityDecisionError,ProductionAdrianSecurityGate,withAdrianExecutionLease} from "../dist/adrian.js";

test('Adrian telemetry removes recognised credentials from prompts, outputs, and tool data', async () => {
 const events = [];
 const handler = {
  handleChatModelStart: async (_model, input) => events.push(input),
  handleLLMEnd: async data => events.push(data),
  handleToolStart: async (_tool, input) => events.push(input),
  handleToolEnd: async output => events.push(output),
 };
 const gate = new ProductionAdrianSecurityGate(handler, {loginAcked:()=>true,policyActive:()=>true,waitForToolCallVerdict:async()=>verdict}, 250);
 await gate.modelTurnStarted({turnId:'turn', model:'model', request:{input:'Normal request\nAuthorization: Bearer fixture-auth-value'}});
 await gate.modelTurnCompleted({turnId:'turn', model:'model', response:{
  output:[{type:'message',content:[{text:'Normal response https://account:fixture-url-value@service.invalid/'}]}],
  usage:{inputTokens:1,outputTokens:1,totalTokens:2},
 }});
 const call = {name:'tool',callId:'call',arguments:{query:'ordinary argument',password:'fixture-password-value'}};
 await gate.authorize(call);
 await gate.completed(call, 'Ordinary result\nCookie: test=fixture-cookie-value');
 const payload = JSON.stringify(events);
 assert.doesNotMatch(payload, /fixture-(?:auth|url|password|cookie)-value/);
 for (const text of ['Normal request', 'Normal response', 'ordinary argument', 'Ordinary result']) assert.ok(payload.includes(text));
});

const verdict={eventId:"event",sessionId:"session",madCode:"",policy:{mode:3,policyM0:false,policyM2:false,policyM3:false,policyM4:false},hitl:null};
test("lower-level evaluator requires readiness and an exact verdict",async()=>{assert.equal((await evaluateAdrianToolCall(null,"call",250)).outcome,"unavailable");assert.equal((await evaluateAdrianToolCall({loginAcked:()=>true,policyActive:()=>true,waitForToolCallVerdict:async()=>verdict},"call",250)).outcome,"allow");assert.equal((await evaluateAdrianToolCall({loginAcked:()=>true,policyActive:()=>true,waitForToolCallVerdict:async()=>null},"call",250)).outcome,"unavailable");assert.equal((await evaluateAdrianToolCall({loginAcked:()=>false,policyActive:()=>true,waitForToolCallVerdict:async()=>verdict},"call",250)).outcome,"unavailable")});
test("exclusive lease fails closed without queueing and always releases",async()=>{const release=acquireAdrianExecutionLease();assert.throws(()=>acquireAdrianExecutionLease(),{category:"security_unavailable"});release();let shutdowns=0;await assert.rejects(withAdrianExecutionLease(async()=>{throw new Error("model")},async()=>{shutdowns++}));assert.equal(shutdowns,1);acquireAdrianExecutionLease()()});
test("production gate blocks without positive evidence before execution",async()=>{let starts=0;const gate=new ProductionAdrianSecurityGate({handleToolStart:async()=>{starts++},handleToolEnd:async()=>{},handleToolError:async()=>{}},{loginAcked:()=>true,policyActive:()=>true,waitForToolCallVerdict:async()=>null},5);await assert.rejects(gate.authorize({name:"mcp",arguments:{},callId:"call"}),error=>error instanceof SecurityDecisionError&&error.category==="security_unavailable");assert.equal(starts,1)});
test("production integration observes model turns and preserves proposed provider call IDs",async()=>{const events=[],handler={handleChatModelStart:async(_model,input,turn)=>events.push(["start",turn,input]),handleLLMEnd:async(data,turn)=>events.push(["end",turn,data]),handleLLMError:async()=>{},handleToolStart:async()=>{},handleToolEnd:async()=>{},handleToolError:async()=>{}},gate=new ProductionAdrianSecurityGate(handler,{loginAcked:()=>true,policyActive:()=>true,waitForToolCallVerdict:async()=>verdict},250);await gate.modelTurnStarted({turnId:"turn-1",model:"gpt-test",request:{systemInstructions:"safe",input:"hello"}});await gate.modelTurnCompleted({turnId:"turn-1",model:"gpt-test",response:{output:[{type:"function_call",callId:"provider-call-7",name:"mcp_tool",arguments:'{"query":"safe"}'}],usage:{inputTokens:2,outputTokens:3,totalTokens:5}}});assert.deepEqual(events.map(item=>item[0]),["start","end"]);assert.equal(events[1][2].toolCalls[0].id,"provider-call-7")});
test("security-critical observer failures are security unavailable",async()=>{const handler={handleChatModelStart:async()=>{throw Error("secret backend")},handleLLMEnd:async()=>{},handleLLMError:async()=>{},handleToolStart:async()=>{throw Error("secret backend")},handleToolEnd:async()=>{},handleToolError:async()=>{}},gate=new ProductionAdrianSecurityGate(handler,{loginAcked:()=>true,policyActive:()=>true,waitForToolCallVerdict:async()=>verdict},250);await assert.rejects(gate.modelTurnStarted({turnId:"turn",model:"model",request:{input:"safe"}}),{category:"security_unavailable"});await assert.rejects(gate.authorize({name:"tool",arguments:{},callId:"call"}),{category:"security_unavailable"})});
