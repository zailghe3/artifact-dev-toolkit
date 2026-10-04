import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { installTsxHook } from './render-tsx.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const requireTsx = installTsxHook();
const { InfrastructureFreshnessIndicator } = requireTsx('../components/InfrastructureFreshnessIndicator.tsx');

const text = node => node.findAll(item => Array.isArray(item.children)).flatMap(item => item.children).filter(item => typeof item === 'string').join(' ');

test('footer freshness renders first, refreshes after expiry, and never polls while hidden', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  let now = Date.parse('2026-09-15T20:00:00.000Z');
  Date.now = () => now;
  let deferredLoad;
  const timers = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  let timerId = 0;
  let visibilityState = 'visible';
  globalThis.window = {
    setTimeout(callback, milliseconds) {
      const id = ++timerId;
      timers.set(id, { callback, milliseconds });
      if (milliseconds === 0) deferredLoad = { id, callback };
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
      if (deferredLoad?.id === id) deferredLoad = undefined;
    },
    addEventListener(type, callback) { windowListeners.set(type, callback); },
    removeEventListener(type, callback) { if (windowListeners.get(type) === callback) windowListeners.delete(type); },
  };
  globalThis.document = {
    get visibilityState() { return visibilityState; },
    addEventListener(type, callback) { documentListeners.set(type, callback); },
    removeEventListener(type, callback) { if (documentListeners.get(type) === callback) documentListeners.delete(type); },
  };
  const snapshot = {
    state: 'current',
    checkedAt: '2026-09-15T20:00:00.000Z',
    components: {
      worker: { state: 'current', deployedRevision: '1'.repeat(40) },
      runtime: { state: 'current', deployedRevision: '2'.repeat(40) },
      runner: { state: 'current', deployedRevision: '3'.repeat(40) },
    },
  };
  const uncertainUpdate = {
    ...snapshot,
    state: 'superseded',
    components: {
      ...snapshot.components,
      worker: { state: 'unknown' },
      runner: { ...snapshot.components.runner, state: 'superseded' },
    },
  };
  let responseSnapshot = snapshot;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json(responseSnapshot); };
  let view;
  try {
    await act(async () => { view = create(React.createElement(InfrastructureFreshnessIndicator)); });
    assert.match(text(view.root), /Checking infra/);
    assert.equal(calls, 0, 'page render must not wait for or start freshness I/O synchronously');
    assert.equal(typeof deferredLoad?.callback, 'function');
    const initialLoad = deferredLoad;
    timers.delete(initialLoad.id);
    deferredLoad = undefined;
    await act(async () => { initialLoad.callback(); await Promise.resolve(); });
    assert.equal(calls, 1);
    assert.match(text(view.root), /Infra current/);
    assert.match(text(view.root), /Runtime 2222222/);
    assert.match(text(view.root), /Runner 3333333/);

    const firstExpiry = [...timers.entries()].find(([, timer]) => timer.milliseconds >= 120_000);
    assert.ok(firstExpiry, 'loaded freshness should schedule an expiry refresh');
    now += 120_001;
    timers.delete(firstExpiry[0]);
    await act(async () => { firstExpiry[1].callback(); await Promise.resolve(); });
    assert.equal(calls, 2, 'an expired visible cache must refresh without requiring a remount');
    assert.match(text(view.root), /Infra current/);

    const hiddenExpiry = [...timers.entries()].find(([, timer]) => timer.milliseconds >= 120_000);
    assert.ok(hiddenExpiry);
    visibilityState = 'hidden';
    now += 120_001;
    timers.delete(hiddenExpiry[0]);
    await act(async () => { hiddenExpiry[1].callback(); await Promise.resolve(); });
    assert.equal(calls, 2, 'an expired hidden tab must not poll');
    assert.equal([...timers.values()].some(timer => timer.milliseconds >= 120_000), false, 'hidden expiry should wait for an explicit return signal');

    visibilityState = 'visible';
    responseSnapshot = uncertainUpdate;
    documentListeners.get('visibilitychange')();
    assert.equal(typeof deferredLoad?.callback, 'function', 'returning to an expired tab should schedule a background refresh');
    const resumedLoad = deferredLoad;
    timers.delete(resumedLoad.id);
    deferredLoad = undefined;
    await act(async () => { resumedLoad.callback(); await Promise.resolve(); });
    assert.equal(calls, 3);
    assert.match(text(view.root), /Runner update available/);

    const shortExpiry = [...timers.entries()].find(([, timer]) => timer.milliseconds === 15_000);
    assert.ok(shortExpiry, 'a superseded aggregate with component uncertainty should use the short retry window');
    responseSnapshot = snapshot;
    now += 15_001;
    timers.delete(shortExpiry[0]);
    await act(async () => { shortExpiry[1].callback(); await Promise.resolve(); });
    assert.equal(calls, 4, 'component uncertainty must refresh after the short TTL');
    assert.match(text(view.root), /Infra current/);
    await act(async () => view.unmount());

    deferredLoad = undefined;
    await act(async () => { view = create(React.createElement(InfrastructureFreshnessIndicator)); });
    assert.equal(calls, 4, 'a still-live cache must not start another request on remount/navigation-like reuse');
    assert.match(text(view.root), /Infra current/);
    assert.equal(deferredLoad, undefined);
    await act(async () => view.unmount());
  } finally {
    Date.now = previousNow;
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('separate stale component actions preserve App information and lock accepted rollout independently',async()=>{
  const previousWindow=globalThis.window,previousDocument=globalThis.document,previousFetch=globalThis.fetch;
  const timers=new Map();let timerId=0,resolveAction,actionCalls=0,freshnessCalls=0;
  globalThis.window={setTimeout(callback,milliseconds){const id=++timerId;timers.set(id,{callback,milliseconds});return id},clearTimeout(id){timers.delete(id)},addEventListener(){},removeEventListener(){}};
  globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
  const stale={state:'superseded',checkedAt:'2026-10-04T00:00:00.000Z',components:{worker:{state:'superseded',deployedRevision:'1'.repeat(40)},runtime:{state:'superseded',deployedRevision:'2'.repeat(40)},runner:{state:'superseded',deployedRevision:'3'.repeat(40)}}};
  globalThis.fetch=async(url)=>{if(String(url).includes('infrastructure-redeploy')){actionCalls++;return new Promise(resolve=>{resolveAction=resolve})}freshnessCalls++;return Response.json(stale)};
  const {clearInfrastructureFreshnessClientCacheForTests}=requireTsx('../components/InfrastructureFreshnessIndicator.tsx');clearInfrastructureFreshnessClientCacheForTests();let view;
  try{
    await act(async()=>{view=create(React.createElement(InfrastructureFreshnessIndicator))});const initial=[...timers.entries()].find(([,value])=>value.milliseconds===0);timers.delete(initial[0]);await act(async()=>{initial[1].callback();await Promise.resolve()});
    assert.match(text(view.root),/App update available/);const buttons=()=>view.root.findAllByType('button');assert.equal(buttons().length,2);assert.equal(buttons()[0].children.join(''),'Runtime update available');assert.equal(buttons()[1].children.join(''),'Runner update available');
    await act(async()=>{void buttons()[0].props.onClick();await Promise.resolve()});assert.equal(actionCalls,1);assert.equal(buttons()[0].props.disabled,true);assert.equal(buttons()[1].props.disabled,false,'Runner remains independently actionable');assert.match(text(view.root),/Requesting runtime update/);
    await act(async()=>{resolveAction(Response.json({state:'accepted',message:'Runtime update requested'},{status:202}));await Promise.resolve();await Promise.resolve()});assert.equal(actionCalls,1);assert.equal(buttons()[0].props.disabled,true,'accepted Runtime stays locked while freshness is superseded');assert.equal(buttons()[1].props.disabled,false);assert.ok(freshnessCalls>=2,'accepted action re-queries normal freshness');assert.match(text(view.root),/Runtime update requested/);assert.doesNotMatch(text(view.root),/Infra current/);
    await act(async()=>view.unmount());
  }finally{globalThis.fetch=previousFetch;if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument}
});

test('ambiguous action feedback is bounded and keeps retry locked while freshness remains superseded',async()=>{
 const previousWindow=globalThis.window,previousDocument=globalThis.document,previousFetch=globalThis.fetch;const timers=new Map();let id=0,actions=0;
 globalThis.window={setTimeout(callback,milliseconds){const value=++id;timers.set(value,{callback,milliseconds});return value},clearTimeout(value){timers.delete(value)},addEventListener(){},removeEventListener(){}};globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const stale={state:'superseded',checkedAt:'2026-10-04T00:00:00.000Z',components:{worker:{state:'current'},runtime:{state:'superseded'},runner:{state:'current'}}};globalThis.fetch=async url=>String(url).includes('infrastructure-redeploy')?(actions++,Response.json({state:'ambiguous',message:'Redeploy request outcome is uncertain. Check freshness before trying again.'},{status:502})):Response.json(stale);
 const {clearInfrastructureFreshnessClientCacheForTests}=requireTsx('../components/InfrastructureFreshnessIndicator.tsx');clearInfrastructureFreshnessClientCacheForTests();let view;try{await act(async()=>{view=create(React.createElement(InfrastructureFreshnessIndicator))});const load=[...timers.entries()].find(([,value])=>value.milliseconds===0);timers.delete(load[0]);await act(async()=>{load[1].callback();await Promise.resolve()});await act(async()=>{await view.root.findByType('button').props.onClick();await Promise.resolve()});assert.equal(actions,1);assert.equal(view.root.findByType('button').props.disabled,true);assert.match(text(view.root),/outcome is uncertain/);assert.doesNotMatch(text(view.root),/private|Portainer|https?:/i);await act(async()=>view.unmount())}finally{globalThis.fetch=previousFetch;if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument}
});
