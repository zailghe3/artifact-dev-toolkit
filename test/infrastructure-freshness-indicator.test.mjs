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
  const sourceHeadRevision = '4'.repeat(40);
  const snapshot = {
    state: 'current',
    checkedAt: '2026-09-15T20:00:00.000Z',
    components: {
      worker: { state: 'current', deployedRevision: '1'.repeat(40), sourceHeadRevision },
      runtime: { state: 'current', deployedRevision: '2'.repeat(40), sourceHeadRevision },
      runner: { state: 'current', deployedRevision: '3'.repeat(40), sourceHeadRevision },
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
