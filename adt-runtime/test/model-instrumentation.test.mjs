import test from "node:test";
import assert from "node:assert/strict";
import {InstrumentedModelProvider} from "../dist/model-instrumentation.js";

const request={input:"safe",modelSettings:{},tools:[],outputType:"text",handoffs:[],tracing:"disabled"};
const instrument=async(delegate,instrumentation)=>await (await new InstrumentedModelProvider({getModel:async()=>delegate},"execution",instrumentation).getModel("model")).getResponse(request);

test("model failure reporting cannot mask the established provider failure",async()=>{const original=Object.assign(new Error("provider failed"),{category:"provider_unavailable"});for(const reporter of [async()=>{},async()=>{throw new Error("observer failed")}])await assert.rejects(instrument({getResponse:async()=>{throw original},getStreamedResponse(){throw new Error()}},{modelTurnStarted:async()=>{},modelTurnCompleted:async()=>{},modelTurnFailed:reporter}),error=>error===original)});
test("model failure reporting cannot mask security-critical completion failure",async()=>{const original=Object.assign(new Error("Security enforcement is unavailable."),{category:"security_unavailable"});await assert.rejects(instrument({getResponse:async()=>({output:[],usage:{}}),getStreamedResponse(){throw new Error()}},{modelTurnStarted:async()=>{},modelTurnCompleted:async()=>{throw original},modelTurnFailed:async()=>{throw new Error("raw Adrian failure")}}),error=>error===original)});
