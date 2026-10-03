import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile,writeFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {withAdrianLocalLog,AdrianLocalLifecycleError} from '../dist/adrian-local-log.js';

const missing=path=>assert.rejects(access(path));

test('ephemeral Adrian JSONL lifecycle removes local observations after shutdown',async()=>{let options,shutdowns=0,logFile;const runtime={init:async value=>{options=value;logFile=value.logFile;await writeFile(logFile,'observed event')},shutdown:async()=>{shutdowns++}};const result=await withAdrianLocalLog(runtime,{apiKey:'secret',sessionId:'session'},async()=>{assert.equal(await readFile(logFile,'utf8'),'observed event');return 'established'});assert.equal(result,'established');assert.equal(shutdowns,1);assert.equal(isAbsolute(options.logFile),true);assert.match(options.logFile,/[/\\]adt-adrian-[^/\\]+[/\\]events\.jsonl$/);assert.doesNotMatch(options.logFile,/secret|session/);await missing(logFile)});

test('init and operation failures still attempt shutdown and remove the temporary directory',async t=>{for(const phase of ['init','operation'])await t.test(phase,async()=>{let logFile,shutdowns=0;const original=Error(`${phase} original`),runtime={init:async options=>{logFile=options.logFile;await writeFile(logFile,'sensitive');if(phase==='init')throw original},shutdown:async()=>{shutdowns++}};const call=withAdrianLocalLog(runtime,{sessionId:'bounded'},async()=>{throw original});if(phase==='init')await assert.rejects(call,error=>error instanceof AdrianLocalLifecycleError&&error.reason==='sdk_init_failed'&&!error.message.includes('original'));else await assert.rejects(call,error=>error===original);assert.equal(shutdowns,1);await missing(logFile)})});

test('local-log creation failure is bounded before SDK init',async()=>{let inits=0;await assert.rejects(withAdrianLocalLog({init:async()=>{inits++},shutdown:async()=>{}},{sessionId:'bounded'},async()=>{}, {makeTemporaryDirectory:async()=>{throw Error('EACCES /private/path')}}),error=>error instanceof AdrianLocalLifecycleError&&error.reason==='local_log_unavailable'&&!/EACCES|private/.test(error.message));assert.equal(inits,0)});

test('cleanup failure cannot replace successful or failed execution outcomes',async t=>{const dependencies={removeTemporaryDirectory:async()=>{throw Error('cleanup failed')}};await t.test('success',async()=>{const value=await withAdrianLocalLog({init:async()=>{},shutdown:async()=>{}},{sessionId:'ok'},async()=>42,dependencies);assert.equal(value,42)});await t.test('failure',async()=>{const original=Error('provider failed');await assert.rejects(withAdrianLocalLog({init:async()=>{},shutdown:async()=>{}},{sessionId:'fail'},async()=>{throw original},dependencies),error=>error===original)})});
