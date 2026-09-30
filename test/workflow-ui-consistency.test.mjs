import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { installTsxHook } from './render-tsx.mjs';
import { workflowSections, workflowSectionState } from '../lib/workflow-navigation.ts';

const requireTsx = installTsxHook();
const { EntityCard, PageHeader } = requireTsx('../components/Ui.tsx');

function activeSection(path) {
  return workflowSectionState(path).find((item) => item.active)?.label;
}

test('Workflow submenu maps exact and nested routes to one active section', () => {
  assert.deepEqual(workflowSections.map(({ label, href }) => [label, href]), [
    ['Overview', '/workflows'],
    ['Runs', '/workflows/runs'],
    ['Workflows', '/workflows/definitions'],
    ['Agents', '/workflows/agents'],
    ['Connections', '/workflows/connections'],
    ['Tools', '/tools'],
    ['Security', '/security'],
  ]);
  assert.equal(activeSection('/workflows'), 'Overview');
  assert.equal(activeSection('/workflows/runs'), 'Runs');
  assert.equal(activeSection('/workflows/runs/123'), 'Runs');
  assert.equal(activeSection('/workflows/definitions/example/edit'), 'Workflows');
  assert.equal(activeSection('/workflows/agents/example'), 'Agents');
  assert.equal(activeSection('/workflows/connections/openai-primary'), 'Connections');
  assert.equal(activeSection('/tools'), 'Tools');
  assert.equal(activeSection('/tools/example/edit'), 'Tools');
  assert.equal(activeSection('/security'), 'Security');
  assert.equal(activeSection('/security/example/edit'), 'Security');
  assert.equal(activeSection('/workflows/codex-environments/example'), undefined);
  for (const path of ['/workflows/runs/123', '/tools/example/edit', '/security/example/edit']) {
    assert.equal(workflowSectionState(path).filter((item) => item.active).length, 1, path);
  }
});

test('Tools and Security layouts expose the protected Workflow section shell', async () => {
  for (const [area, returnPath] of [['tools', '/tools'], ['security', '/security']]) {
    const source = await readFile(new URL(`../app/${area}/layout.tsx`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`requireRepositoryAuthorization\\("${returnPath}"\\)`));
    assert.match(source, /<AppHeader/);
    assert.match(source, /<WorkflowSubnav\s*\/>/);
  }
});

test('shared application page header exposes its title, description, and optional creation action', () => {
  const html = renderToStaticMarkup(React.createElement(PageHeader, {
    title: 'Agents',
    description: 'Manage reusable Agents.',
    action: { href: '/workflows/agents/new', label: 'New agent' },
  }));
  assert.match(html, /<header\b/);
  assert.match(html, /<h1[^>]*>Agents<\/h1>/);
  assert.match(html, /Manage reusable Agents\./);
  assert.match(html, /href="\/workflows\/agents\/new"[^>]*>New agent<\/a>/);
});

test('entity-card navigation and actions are separate interactive regions', () => {
  const html = renderToStaticMarkup(React.createElement(
    EntityCard,
    {
      href: '/workflows/agents/reviewer',
      label: 'Open agent Reviewer',
      actions: React.createElement('button', { type: 'button', 'aria-label': 'Delete agent Reviewer' }, 'Delete'),
    },
    React.createElement('h2', null, 'Reviewer'),
  ));
  assert.match(html, /data-entity-card="true"/);
  assert.match(html, /data-entity-card-link="true"/);
  assert.match(html, /data-entity-card-actions="true"/);
  const linkStart = html.indexOf('data-entity-card-link');
  const linkEnd = html.indexOf('</a>', linkStart);
  const actionStart = html.indexOf('data-entity-card-actions');
  assert.ok(linkStart >= 0 && linkEnd > linkStart && actionStart > linkEnd);
  assert.doesNotMatch(html.slice(linkStart, linkEnd), /<button\b/);
  assert.match(html.slice(actionStart), /aria-label="Delete agent Reviewer"/);
});
