import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installTsxHook } from './render-tsx.mjs';
import { applicationIdentity, primaryNavigation, primaryNavigationState } from '../lib/app-navigation.ts';

const requireTsx = installTsxHook();
const { ApplicationShell } = requireTsx('../components/ApplicationShell.tsx');
const { PathnameContext } = requireTsx('next/dist/shared/lib/hooks-client-context.shared-runtime');

test('primary navigation exposes the stable product destinations', () => {
  assert.equal(applicationIdentity.name, 'Artifact Toolkit');
  assert.deepEqual(primaryNavigation.map(({ label, href }) => [label, href]), [['Artifacts', '/'], ['Workflows', '/workflows'], ['Advisor', '/advisor'], ['Diagnostics', '/diagnostics']]);
});

test('primary navigation resolves one active product area for nested routes', () => {
  const cases = [
    ['/', 'Artifacts'],
    ['/artifacts/example/edit', 'Artifacts'],
    ['/workflows/runs', 'Workflows'],
    ['/tools', 'Workflows'],
    ['/tools/example/edit', 'Workflows'],
    ['/security', 'Workflows'],
    ['/security/example/edit', 'Workflows'],
    ['/advisor/knowledge', 'Advisor'],
    ['/diagnostics', 'Diagnostics'],
  ];
  for (const [path, expected] of cases) {
    const state = primaryNavigationState(path);
    assert.equal(state.filter((item) => item.active).length, 1, path);
    assert.equal(state.find((item) => item.active)?.label, expected, path);
  }
});

function renderShell(pathname, initialExpanded) {
  return renderToStaticMarkup(React.createElement(PathnameContext.Provider, { value: pathname },
    React.createElement(ApplicationShell, { login: 'octocat', initialExpanded },
      React.createElement('h1', null, 'Protected content'))));
}

test('expanded shell exposes all destinations and marks the active nested link', () => {
  const html = renderShell('/security/example/edit', true);
  assert.match(html, /<nav aria-label="Primary"/);
  assert.match(html, /aria-current="page"[^>]*href="\/security"/);
  for (const label of ['Artifacts', 'Workflows', 'Definitions', 'Runs', 'Agents', 'Connections', 'Tools', 'Security', 'Advisor', 'Knowledge', 'Settings', 'Diagnostics']) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Collapse sidebar"/);
  assert.match(html, /aria-label="Open navigation"/);
  assert.match(html, /href="#main-content"/);
  assert.match(html, /<main[^>]*id="main-content"/);
  assert.match(html, /aria-label="Account for octocat"/);
});

test('icon rail retains accessible destinations and an expand control', () => {
  const html = renderShell('/diagnostics', false);
  assert.match(html, /aria-label="Expand sidebar"/);
  assert.match(html, /aria-label="Definitions"/);
  assert.match(html, /aria-current="page" aria-label="Diagnostics"/);
});
