import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { installTsxHook } from './render-tsx.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.self = globalThis;
const requireTsx = installTsxHook();
const { AppRouterContext } = requireTsx('next/dist/shared/lib/app-router-context.shared-runtime');
const { WorkflowResponse } = requireTsx('../components/WorkflowResponse.tsx');
const { ConversationWorkspace } = requireTsx('../components/ConversationWorkspace.tsx');
const wrap = (child, value = {}) => React.createElement(AppRouterContext.Provider,
  { value: { push() {}, replace() {}, refresh() {}, prefetch() {}, ...value } }, child);

test('rendered Markdown uses semantic tables and omits executable content and generated actions', () => {
  const markdown = [
    '# Finding', '', '> Evidence', '', '- A reason', '',
    '| Region | State |', '| --- | --- |', '| One | OK |', '',
    '[Good](https://example.com) [Bad](java&#x73;cript:alert%281%29)',
    '<script>dangerous_source()</script>', '', '<img src=x onerror=trigger()>', '',
    'Review & save to knowledge', '',
  ].join('\n');
  const html = renderToStaticMarkup(wrap(React.createElement(WorkflowResponse, {
    runId: 'run-id', sections: [{ id: 'answer', markdown }],
  })));
  assert.match(html, /<h3>Finding<\/h3>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<ul><li>/);
  assert.match(html, /<th scope="col">Region<\/th>/);
  assert.match(html, /<td>OK<\/td>/);
  assert.match(html, /href="https:\/\/example.com\/"[^>]*rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /javascript:|<script|<img|dangerous_source|trigger\(\)/i);
  assert.doesNotMatch(html, /<button[^>]*>Review &amp; save to knowledge/);
});

test('code copy preserves exact parsed code and raw mode preserves the full original Markdown', async t => {
  const code = '  first  \r\n\tsecond\r\n';
  const markdown = `~~~ts\r\n${code}\r\n~~~`;
  const writes = [];
  t.mock.getter(globalThis, 'navigator', () => ({ clipboard: { writeText: async text => writes.push(text) } }));
  const priorWindow = globalThis.window;
  globalThis.window = { setTimeout() {} };
  let view;
  try {
    await act(async () => { view = create(wrap(React.createElement(WorkflowResponse, { runId: 'run', sections: [{ id: 'answer', markdown }] }))); });
    await act(async () => { await view.root.findByProps({ 'aria-label': 'Copy code block' }).props.onClick(); });
    await act(async () => { await view.root.findByProps({ 'aria-label': 'Copy complete response' }).props.onClick(); });
    assert.deepEqual(writes, [code, markdown]);
    await act(async () => { view.root.findByProps({ 'aria-pressed': false }).props.onClick(); });
    assert.deepEqual(view.root.findByType('pre').children, [markdown]);
  } finally {
    if (view) await act(async () => view.unmount());
    if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow;
  }
});

test('the shared composer applies a Workflow template and retries an uncertain submission by its original identity', async t => {
  const requests = [];
  const workflow = { kind: 'workflow', id: 'advisor', name: 'Advisor', starter: 'Review:\n- ' };
  const target = { kind: workflow.kind, id: workflow.id };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.startsWith('/api/conversations/targets')) return Response.json({ targets: [workflow] });
    if (url === '/api/conversations' && init.method === 'POST') {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (requests.length === 1) throw Error('unconfirmed transport');
      return Response.json({ ...body, runId: crypto.randomUUID(), replay: true });
    }
    return Response.json({ items: [], next: null });
  });
  let view, opened;
  try {
    await act(async () => {
      view = create(wrap(React.createElement(ConversationWorkspace, { view: '/advisor', preselected: target, draftScope: 'fixture' }),
        { replace(href) { opened = href; } }));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    assert.equal(view.root.findByType('textarea').props.value, workflow.starter);
    assert.equal(view.root.findAllByType('select').length, 0);
    const submit = () => view.root.findAllByType('form').at(-1).props.onSubmit({ preventDefault() {} });
    await act(submit);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].target, target);
    assert.equal(view.root.findByType('textarea').props.disabled, true);
    await act(submit);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(opened, `/advisor?conversation=${requests[0].conversationId}`);
  } finally { if (view) await act(async () => view.unmount()); }
});
