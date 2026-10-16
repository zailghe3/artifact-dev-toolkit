import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { publicationPlan, reconcile, resolveRuntimeSource, isMissingManifest } from '../scripts/reconcile-runtime-publication.mjs';
const source='a'.repeat(40),digest=`sha256:${'1'.repeat(64)}`, release=5;
const current={source,release,digest};
const state=(sha=null,revision=null,latest=null)=>({source,release,sha,revision,latest});
test('blocked mixed release is reconciled by descendant app repair and repeated reconciliation is a validated no-op',()=>{
  const tags=new Map(), pushed=[];
  const run=()=>reconcile({source,release,refresh(){},observe:tag=>tags.get(tag)||null,push(tag){tags.set(tag,current);pushed.push(tag);}});
  // Failed deployment never calls the publisher (workflow policy tests cover the gate).
  assert.equal(tags.size,0);
  assert.equal(run(),'published');
  assert.deepEqual(pushed,[source,'r5','latest']);
  assert.equal(run(),'noop');assert.equal(pushed.length,3);
});
test('Runtime-only release can publish after a trusted older latest',()=>{
  const older={source:'b'.repeat(40),release:4,digest:`sha256:${'2'.repeat(64)}`};
  assert.equal(publicationPlan(state(null,null,older)),'publish');
});
test('immutable tags and latest must form a consistent completely observed publication',()=>{
  for(const value of [state(current),state(null,current),state(current,current),state(current,current,{...current,release:4}),state(current,{...current,digest:`sha256:${'2'.repeat(64)}`},current),state({...current,source:'b'.repeat(40)},current,current),state(null,null,current),state(current,current,{...current,source:'b'.repeat(40)}),{...state(),sha:undefined}]) {
    assert.throws(()=>publicationPlan(value));
  }
});
test('latest never moves backwards from a validated newer release',()=>{
  const newer={source:'b'.repeat(40),release:6,digest:`sha256:${'2'.repeat(64)}`};
  assert.equal(publicationPlan(state(current,current,newer)),'noop');
  assert.throws(()=>publicationPlan(state(null,null,newer)));
});
test('inspection errors and stale source fail before any push',()=>{
  for(const failing of ['observe','refresh']) {
    let pushes=0;
    assert.throws(()=>reconcile({source,release,observe(){if(failing==='observe')throw Error('registry unavailable');return null;},refresh(){if(failing==='refresh')throw Error('superseded');},push(){pushes++;}}));
    assert.equal(pushes,0);
  }
});
test('partial failure on push fails closed on retry without overwriting immutable tags',()=>{
  const tags=new Map();let pushes=0;
  const options={source,release,refresh(){},observe:tag=>tags.get(tag)||null,push(tag){if(++pushes===2)throw Error('network');tags.set(tag,current);}};
  assert.throws(()=>reconcile(options),/network/);
  assert.throws(()=>reconcile(options),/Partial immutable/);assert.equal(pushes,2);
});
test('only explicit MANIFEST_UNKNOWN means absent, never authentication or transport errors',()=>{
  const ref='poulti/adt-runtime:r5';
  assert.equal(isMissingManifest({stderr:`Error response from daemon: manifest for ${ref} not found: manifest unknown: manifest unknown\n`},ref),true);
  for(const stderr of ['unauthorized','connection refused','timeout','denied','manifest unknown','not found'])assert.equal(isMissingManifest({stderr},ref),false);
});
test('canonical source stays at the mixed release through app-only descendants',()=>{
  const repair='c'.repeat(40);
  const run=args=> args[0]==='rev-list' && args[1]==='--first-parent' ? `${repair}\n${source}`
    : args[0]==='rev-list' ? `${args.at(-1)} ${'b'.repeat(40)}`
      : args.at(-1)===repair ? 'package.json\npackage-lock.json' : 'adt-runtime/package.json\nadt-runtime/release.json';
  assert.equal(resolveRuntimeSource(repair,run),source);
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  assert.match(resolveRuntimeSource(head),/^[a-f0-9]{40}$/);
});
test('a different latest must agree with its own trusted immutable pair',()=>{
  const older={source:'b'.repeat(40),release:4,digest:`sha256:${'2'.repeat(64)}`};let pushes=0;
  assert.throws(()=>reconcile({source,release,refresh(){},observe:tag=>tag==='latest'?older:null,push(){pushes++;}}));
  assert.equal(pushes,0);
});
