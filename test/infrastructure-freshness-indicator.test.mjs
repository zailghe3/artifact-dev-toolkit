import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { installTsxHook } from './render-tsx.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const requireTsx = installTsxHook();
const { InfrastructureFreshnessIndicator } = requireTsx('../components/InfrastructureFreshnessIndicator.tsx');

const text = node => node.findAll(item => Array.isArray(item.children)).flatMap(item => item.children).filter(item => typeof item === 'string').join(' ');

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}

test('footer freshness renders first, fetches asynchronously, and reuses the session result', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const sessionStorage = storage();
  let deferredLoad;
  const timers = new Map();
  let timerId = 0;
  globalThis.window = {
    sessionStorage,
    setTimeout(callback, milliseconds) {
      const id = ++timerId;
      if (milliseconds === 0) deferredLoad = callback;
      else timers.set(id, setTimeout(callback, milliseconds));
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) clearTimeout(timer);
      timers.delete(id);
      if (id === timerId) deferredLoad = undefined;
    },
  };
  const snapshot = {
    state: 'current',
    checkedAt: '2026-09-15T20:00:00.000Z',
    components: {
      worker: { state: 'current', deployedRevision: '1'.repeat(40), latestRelevantRevision: '1'.repeat(40) },
      runtime: { state: 'current', deployedRevision: '2'.repeat(40), latestRelevantRevision: '2'.repeat(40) },
      runner: { state: 'current', deployedRevision: '3'.repeat(40), latestRelevantRevision: '3'.repeat(40) },
    },
  };
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json(snapshot); };
  let view;
  await act(async () => { view = create(React.createElement(InfrastructureFreshnessIndicator)); });
  assert.match(text(view.root), /Checking infra/);
  assert.equal(calls, 0, 'page render must not wait for or start freshness I/O synchronously');
  assert.equal(typeof deferredLoad, 'function');
  await act(async () => { deferredLoad(); await Promise.resolve(); });
  assert.equal(calls, 1);
  assert.match(text(view.root), /Infra current/);
  assert.match(text(view.root), /Runtime 2222222/);
  assert.match(text(view.root), /Runner 3333333/);
  await act(async () => view.unmount());

  deferredLoad = undefined;
  await act(async () => { view = create(React.createElement(InfrastructureFreshnessIndicator)); });
  assert.equal(calls, 1, 'cached freshness must not start a second request on remount/navigation-like reuse');
  assert.match(text(view.root), /Infra current/);
  assert.equal(deferredLoad, undefined);
  await act(async () => view.unmount());
  globalThis.fetch = previousFetch;
  if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
});
