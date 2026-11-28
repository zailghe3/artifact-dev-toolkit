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
const { WorkflowInteraction } = requireTsx('../components/WorkflowInteraction.tsx');
const { WorkflowRunActivity } = requireTsx('../components/WorkflowRunActivity.tsx');
const { WorkflowRunContentView } = requireTsx('../components/WorkflowRunContent.tsx');
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

test('a human decision explicitly confirms one selection and reconciles a lost acknowledgement', async t => {
  const runId = crypto.randomUUID();
  const item = { id: crypto.randomUUID(), nodeId: 'route', activationId: 'visit', sequence: 2, generation: 1,
    requestedAt: new Date().toISOString(), actionable: true, request: { version: 1, kind: 'decision',
      question: 'Choose a direction', allowGuidance: true, routing: 'branches', options: [
        { id: 'one', title: 'Use one approach' }, { id: 'two', title: 'Use a second approach', value: 'Frame the proposal around **measured outcomes**.' },
      ] } };
  const accepted = { ...item, actionable: false,
    response: { kind: 'decision', optionId: 'two', guidance: 'Keep the exact spacing.  \n' } };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
    if (init?.method === 'POST') throw new Error('Fixture lost the acknowledgement');
    return Response.json(accepted);
  });
  const Demo = () => {
    const [current, update] = React.useState(item);
    return React.createElement(WorkflowInteraction, { runId, item: current, onAccepted: update });
  };
  let view;
  try {
    await act(async () => { view = create(wrap(React.createElement(Demo))); });
    assert.ok(view.root.findAllByProps({ type: 'radio' }).every(radio => !radio.props.checked));
    assert.equal(view.root.findByProps({ type: 'submit' }).props.disabled, true);
    await act(async () => {
      view.root.findAllByProps({ type: 'radio' })[1].props.onChange();
      view.root.findByType('textarea').props.onChange({ target: { value: accepted.response.guidance } });
    });
    assert.equal(calls.length, 0);
    assert.equal(view.root.findByProps({ type: 'submit' }).props.disabled, false);
    await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    assert.deepEqual(calls.map(({ method, body }) => [method, body]), [['POST', accepted.response], ['GET', undefined]]);
    assert.ok(calls.every(call => call.url.endsWith(`/workflow-runs/${runId}/interactions/${item.id}`)));
    assert.equal(view.root.findAllByType('form').length, 0);
    assert.ok(JSON.stringify(view.toJSON()).includes('Response recorded'));
    assert.equal(view.root.findByProps({ 'aria-label': 'Selected content for Use a second approach' }).type, 'summary');
  } finally { if (view) await act(async () => view.unmount()); }
});

test('option values are inspectable Markdown before selection and in the recorded decision', () => {
  const item = { id: crypto.randomUUID(), nodeId: 'decision', actionable: true, request: {
    kind: 'decision', question: 'Which narrative?', allowGuidance: true, options: [
      { id: 'measure', title: 'Evidence route', description: 'Start with a survey.', value: '# Survey results\n\n- Three findings\n\n<script>bad()</script>' },
      { id: 'story', title: 'Story route', value: '**Customer story**' },
      { id: 'table', title: 'Summary route', description: 'Use the results table.', value: 'Use the results table.' },
      { id: 'fallback', title: 'Use the original title' },
    ],
  } };
  const render = current => renderToStaticMarkup(wrap(React.createElement(WorkflowInteraction, { runId: 'run', item: current, onAccepted() {} })));
  const pending = render(item);
  assert.match(pending, /<summary[^>]*aria-label="Option content for Evidence route"/);
  assert.match(pending, /<h3>Survey results<\/h3>/);
  assert.match(pending, /<strong>Customer story<\/strong>/);
  assert.match(pending, /Start with a survey\./);
  assert.equal(pending.match(/Use the results table\./g).length, 1);
  assert.equal(pending.match(/Use the original title/g).length, 1);
  assert.doesNotMatch(pending, /<script|bad\(\)|<label[^>]*>(?:(?!<\/label>)[\s\S])*<details/);

  const history = render({ ...item, actionable: false, response: { kind: 'decision', optionId: 'measure', guidance: 'Confirm sample size.' } });
  assert.match(history, /<summary[^>]*aria-label="Selected content for Evidence route"/);
  assert.match(history, /<h3[^>]*>Human guidance<\/h3>/);
  assert.match(history, /Confirm sample size\./);
  assert.match(history, /View offered options[\s\S]*<strong>Customer story<\/strong>/);
  assert.equal(history.match(/Survey results/g).length, 1);
  assert.doesNotMatch(history, /type="radio"|type="submit"/);
});

const buttonNamed = (view, label) => view.root.findAllByType('button').find(button => button.children.includes(label));
const digits = count => Array.from({ length: count }, (_, index) => index + 1);
const outputId = index => `display-${String(index).padStart(3, '0')}`;
const displayItem = index => ({ kind: 'display', sequence: index,
  section: { id: outputId(index), label: `Display ${index}`, contentSource: 'display', preview: 'Excerpt only' } });
const outputText = index => `  Output ${index}\r\n`;

test('Run content reconciles a burst across moving pages and copies the committed snapshot independently', async t => {
  let latest = 30, leapWhileReading = false;
  const copied = [], hydrated = [], earlierReads = [];
  const page = (before = Infinity) => {
    const items = digits(latest).filter(index => index < before).slice(-12).map(displayItem);
    return { items, before: items[0]?.sequence > 1 ? { sequence: items[0].sequence, id: items[0].section.id } : null,
      revision: `revision-${latest}`, observedAt: new Date(latest * 1000).toISOString() };
  };
  t.mock.method(globalThis, 'fetch', async url => {
    const query = new URL(url, 'https://fixture.example').searchParams;
    if (query.get('view') === 'outputs') return Response.json(digits(latest).map(index => ({
      id: outputId(index), contentSource: 'display',
    })));
    if (query.get('view') === 'display') {
      const index = Number(query.get('activationId').split('-').at(-1));
      hydrated.push(index);
      return Response.json({ markdown: outputText(index) });
    }
    assert.equal(query.get('view'), 'content');
    const before = query.has('beforeSequence') ? Number(query.get('beforeSequence')) : undefined;
    if (before !== undefined) earlierReads.push(before);
    if (leapWhileReading && before !== undefined) { leapWhileReading = false; latest++; }
    return Response.json(page(before));
  });
  t.mock.getter(globalThis, 'navigator', () => ({ clipboard: { writeText: async text => copied.push(text) } }));
  const oldWindow = globalThis.window;
  globalThis.window = { setTimeout() {} };
  let view;
  const displayLabels = () => view.root.findAllByType('h3').map(node => node.children.join('')).filter(text => /^Display \d+$/.test(text));
  const render = head => wrap(React.createElement(WorkflowRunContentView, { runId: 'run', page: head, sections: [] }));
  try {
    const initial = page();
    await act(async () => { view = create(render(initial)); });
    await act(async () => { await buttonNamed(view, 'Load earlier Run content').props.onClick(); });
    assert.deepEqual(displayLabels(), digits(30).slice(6).map(n => `Display ${n}`));
    latest = 61;
    await act(async () => { await view.root.findByProps({ 'aria-label': 'Copy all Workflow outputs' }).props.onClick(); });
    assert.deepEqual(copied, [digits(61).map(outputText).join('\n\n')]);
    assert.equal(hydrated.length, 61);
    assert.deepEqual(displayLabels(), digits(30).slice(6).map(n => `Display ${n}`));

    leapWhileReading = true;
    await act(async () => { view.update(render(page())); });
    assert.equal(latest, 62);
    assert.deepEqual(displayLabels(), digits(62).slice(6).map(n => `Display ${n}`));
    const beforeUnchanged = earlierReads.length;
    await act(async () => { view.update(render(initial)); });
    assert.deepEqual(displayLabels(), digits(62).slice(6).map(n => `Display ${n}`));
    await act(async () => { view.update(render(page())); });
    assert.equal(earlierReads.length, beforeUnchanged);
    await act(async () => { await buttonNamed(view, 'Load earlier Run content').props.onClick(); });
    assert.deepEqual(displayLabels(), digits(62).map(n => `Display ${n}`));
    assert.equal(hydrated.length, 61);

    await act(async () => {
      view.update(wrap(React.createElement(WorkflowRunContentView, { key: 'empty-timeline', runId: 'run',
        page: { items: [], before: null, revision: 'older-empty-page' }, sections: [{ id: 'run:output', markdown: 'Cached final response' }],
      })));
    });
    await act(async () => { await view.root.findByProps({ 'aria-label': 'Copy all Workflow outputs' }).props.onClick(); });
    assert.equal(copied.at(-1), digits(62).map(outputText).join('\n\n'));
  } finally {
    if (view) await act(async () => view.unmount());
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
});

test('activity refresh preserves loaded visits and reconciles their final states during retries and cancellation', async t => {
  const epoch = Date.parse('2026-11-28T12:00:00.000Z');
  const entry = (n, state = 'completed') => ({
    id: `attempt-${n}`, nodeId: `node-${n}`, name: `Step ${n}`, state, at: new Date(epoch + n * 1000).toISOString(),
  });
  let activity = digits(21).map(n => entry(n, n === 3 ? 'running' : 'completed'));
  let revision = 0, poll;
  t.mock.method(globalThis, 'setInterval', (callback, interval) => { assert.equal(interval, 2000); poll = callback; return 1; });
  t.mock.method(globalThis, 'fetch', async url => {
    const query = new URL(url, 'https://fixture.example').searchParams;
    assert.equal(query.get('view'), 'activity');
    const before = query.get('beforeAt');
    const visible = [...activity].filter(item => !before || item.at < before).reverse();
    const entries = visible.slice(0, 14);
    return Response.json({ entries, before: visible.length > entries.length ? { at: entries.at(-1).at, id: entries.at(-1).id } : null,
      completed: activity.filter(item => item.state === 'completed').length, revision: String(revision) });
  });
  const oldDocument = globalThis.document;
  globalThis.document = { visibilityState: 'visible' };
  let view;
  const render = status => wrap(React.createElement(WorkflowRunActivity, { runId: 'run', status }));
  const rows = () => view.root.findAllByType('li').map(node => node.findAllByType('p').map(p => p.children.join('')));
  try {
    await act(async () => { view = create(render('running')); });
    await act(async () => { await buttonNamed(view, 'Load earlier activity').props.onClick(); });
    assert.equal(rows().length, 21);
    assert.deepEqual(rows().at(-3), ['Step 3', 'Running']);

    activity = digits(54).map(n => entry(n));
    revision++;
    await act(async () => { poll(); });
    assert.deepEqual(rows().map(row => row[0]), digits(54).reverse().map(n => `Step ${n}`));
    assert.deepEqual(rows().at(-3), ['Step 3', 'Completed']);

    activity[5] = entry(6, 'failed');
    activity.push({ ...entry(55, 'running'), name: 'Step 6', nodeId: 'node-6', attempt: 2 });
    revision++;
    await act(async () => { poll(); });
    assert.deepEqual(rows().filter(row => row[0] === 'Step 6').map(row => row[1]), ['Running · Attempt 2', 'Failed']);

    activity.at(-1).state = 'cancelled';
    revision++;
    await act(async () => { view.update(render('cancelled')); });
    assert.equal(rows().length, 55);
    assert.deepEqual(rows().filter(row => row[0] === 'Step 6').map(row => row[1]), ['Cancelled · Attempt 2', 'Failed']);
  } finally {
    if (view) await act(async () => view.unmount());
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
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

test('complete response copies every authorised section in order without eager loading or trimming', async t => {
  const first = '  First finding with spacing. \r\n';
  const second = '~~~txt\nSecond finding.  \n~~~';
  const final = 'Final answer.  \n';
  const requestIds = [], writes = [];
  const inline = id => ({ id, label: 'Finding', actions: [{ id, kind: 'knowledge-proposal' }] });
  t.mock.method(globalThis, 'fetch', async url => {
    const id = url.split('/').at(-1);
    requestIds.push(id);
    return Response.json({ markdown: id === 'first-visit' ? first : second });
  });
  t.mock.getter(globalThis, 'navigator', () => ({ clipboard: { writeText: async text => writes.push(text) } }));
  const priorWindow = globalThis.window;
  globalThis.window = { setTimeout() {} };
  let view;
  try {
    await act(async () => { view = create(wrap(React.createElement(WorkflowResponse, {
      runId: 'run', sections: [inline('first-visit'), inline('second-visit'), { id: 'run:output', markdown: final }],
    }))); });
    assert.deepEqual(requestIds, []);
    const preview = view.root.findAllByType('button').filter(button => button.children.join('') === 'View output');
    assert.equal(preview.length, 2);
    await act(async () => { preview[0].props.onClick(); });
    await act(async () => { await view.root.findByProps({ 'aria-label': 'Copy section' }).props.onClick(); });
    await act(async () => { await view.root.findByProps({ 'aria-label': 'Copy complete response' }).props.onClick(); });
    assert.deepEqual(requestIds, ['first-visit', 'second-visit']);
    assert.deepEqual(writes, [first, [first, second, final].join('\n\n')]);
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
