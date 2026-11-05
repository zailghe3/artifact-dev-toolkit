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
const legacyMissing=ref=>`Error response from daemon: manifest for ${ref} not found: manifest unknown: manifest unknown`;
// containerd's pull path formats the resolved reference with Go's %q.
const modernMissing=ref=>`Error response from daemon: failed to resolve reference "${ref}": ${ref}: not found`;
test('known missing-manifest forms accept only the exact Runtime reference and its Docker Hub alias',()=>{
  for(const tag of [source,`r${release}`,'latest']) {
    const shorthand=`poulti/adt-runtime:${tag}`,canonical=`docker.io/${shorthand}`;
    for(const expected of [shorthand,canonical])for(const observed of [shorthand,canonical])for(const missing of [legacyMissing,modernMissing]) {
      assert.equal(isMissingManifest({stderr:`${missing(observed)}\n`},expected),true,`${expected}: ${missing(observed)}`);
    }
  }
});
test('recognized modern Docker absence permits initial publication and a validated no-op on repetition',()=>{
  const tags=new Map(),pushed=[];
  const run=()=>reconcile({source,release,refresh(){},observe(tag){
    if(tags.has(tag))return tags.get(tag);
    const reference=`poulti/adt-runtime:${tag}`,error={stderr:modernMissing(`docker.io/${reference}`)};
    if(isMissingManifest(error,reference))return null;
    throw Error('registry error is not absence');
  },push(tag){tags.set(tag,current);pushed.push(tag);}});
  assert.equal(run(),'published');assert.deepEqual(pushed,[source,`r${release}`,'latest']);
  assert.equal(run(),'noop');assert.equal(pushed.length,3);
});
test('ambiguous registry errors and mismatched references fail closed before any publication push',()=>{
  const ref=`poulti/adt-runtime:${source}`,canonical=`docker.io/${ref}`;
  const rejected=[
    '', 'not found', 'manifest unknown', 'unauthorized', 'authentication required', 'denied', 'insufficient_scope: authorization failed',
    'Error response from daemon: unauthorized: authentication required',
    'Error response from daemon: denied: requested access to the resource is denied',
    'toomanyrequests: 429 Too Many Requests', '500 Internal Server Error', '503 Service Unavailable',
    'connection refused', 'dial tcp: lookup registry-1.docker.io: no such host', 'TLS handshake timeout',
    'x509: certificate signed by unknown authority', 'context deadline exceeded', 'timeout', 'unexpected EOF', 'connection reset by peer',
    ...[legacyMissing,modernMissing].flatMap(missing=>[
      missing('docker.io/poulti/adt-runtime:other-tag'),missing(`docker.io/other/adt-runtime:${source}`),
      missing(`docker.io/poulti/adt-runtime-other:${source}`),missing(`registry.example/poulti/adt-runtime:${source}`),
      `unrelated ${ref}\n${missing('docker.io/other/adt-runtime:other-tag')}`,
      `${missing(canonical)}\nunauthorized`,`${missing(canonical)} extra text`,
    ]),
    `Error response from daemon: failed to resolve reference "${canonical}": ${canonical}: unauthorized`,
    `Error response from daemon: failed to resolve reference "${canonical}": ${canonical}: 429 Too Many Requests`,
    `Error response from daemon: failed to resolve reference "${canonical}": docker.io/poulti/adt-runtime:other-tag: not found`,
    `Error response from daemon: failed to resolve reference ${canonical}: ${canonical}: not found`,
    `Error response from daemon: failed to resolve reference "${canonical}: ${canonical}: not found`,
    `unrelated reference ${ref}: not found`,
  ];
  for(const stderr of rejected) {
    const error={stderr};assert.equal(isMissingManifest(error,ref),false,stderr);
    let pushes=0;
    assert.throws(()=>reconcile({source,release,refresh(){},observe(){
      if(isMissingManifest(error,ref))return null;
      throw Error('registry error is not absence');
    },push(){pushes++;}}),/registry error is not absence/);
    assert.equal(pushes,0,stderr);
  }
  for(const expected of ['registry.example/'+ref,`other/adt-runtime:${source}`,ref+'\nunauthorized']) {
    assert.equal(isMissingManifest({stderr:legacyMissing(expected)},expected),false);
    assert.equal(isMissingManifest({stderr:modernMissing(expected)},expected),false);
  }
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
