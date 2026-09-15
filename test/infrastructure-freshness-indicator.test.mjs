import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { installTsxHook } from './render-tsx.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const requireTsx = installTsxHook();
const { InfrastructureFreshnessIndicator } = requireTsx('../components/InfrastructureFreshnessIndicator.tsx');

const text = node => node.findAll(item => Array.isArray(item.children)).flatMap(item => item.children).filter(item => typeof item === 'string').join(' ');

test('footer freshness renders first, reuses a live cache, and refreshes it after expiry', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  let now = Date.parse('2026-09-15T20:00:00.000Z');
  Date.now = () => now;
  let deferredLoad;
  const timers = new Map();
  let timerId = 0;
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
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json(snapshot); };
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

    const expiry = [...timers.entries()].find(([, timer]) => timer.milliseconds >= 120_000);
    assert.ok(expiry, 'loaded freshness should schedule an expiry refresh');
    now += 120_001;
    timers.delete(expiry[0]);
    await act(async () => { expiry[1].callback(); await Promise.resolve(); });
    assert.equal(calls, 2, 'an expired visible cache must refresh without requiring a remount');
    assert.match(text(view.root), /Infra current/);
    await act(async () => view.unmount());

    deferredLoad = undefined;
    await act(async () => { view = create(React.createElement(InfrastructureFreshnessIndicator)); });
    assert.equal(calls, 2, 'a still-live cache must not start another request on remount/navigation-like reuse');
    assert.match(text(view.root), /Infra current/);
    assert.equal(deferredLoad, undefined);
    await act(async () => view.unmount());
  } finally {
    Date.now = previousNow;
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});
