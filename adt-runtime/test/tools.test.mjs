import test from 'node:test';
import assert from 'node:assert/strict';
import {executeToolWithSecurityGate} from '../dist/tools.js';

test('authorize remains authoritative and prevents underlying execution',async()=>{let calls=0;const denied=Object.assign(new Error('denied'),{code:'denied'}),tool={name:'side_effect',execute:async()=>{calls++;return'ok'}};await assert.rejects(executeToolWithSecurityGate(tool,{authorize:async()=>{throw denied}},{}),error=>error===denied);assert.equal(calls,0)});

test('completion reporting cannot fail or replay a successful MCP side effect',async()=>{let calls=0,reported=0;const tool={name:'mcp_side_effect',execute:async()=>{calls++;return'committed'}};const result=await executeToolWithSecurityGate(tool,{authorize:async()=>{},completed:async()=>{reported++;throw new Error('observer unavailable')}},{value:1},'provider-call');assert.equal(result,'committed');assert.equal(calls,1);assert.equal(reported,1)});

test('failure reporting cannot mask the original tool failure',async()=>{const original=Object.assign(new Error('remote outcome'),{ambiguous:true}),tool={name:'mcp_failure',execute:async()=>{throw original}};await assert.rejects(executeToolWithSecurityGate(tool,{authorize:async()=>{},failed:async()=>{throw new Error('observer unavailable')}},{},'provider-call'),error=>error===original)});
