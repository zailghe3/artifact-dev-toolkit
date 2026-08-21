import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { installTsxHook } from './render-tsx.mjs';
const requireTsx = installTsxHook();
const { AppHeader } = requireTsx('../components/AppHeader.tsx');
const { OperationalState } = requireTsx('../components/OperationalState.tsx');
const { ProtectedArtifactShell } = requireTsx('../components/ProtectedArtifactShell.tsx');
import { applicationIdentity, primaryNavigation, primaryNavigationState } from '../lib/app-navigation.ts';

const textCount = (html, text) => (html.match(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;

test('primary navigation exposes the stable product destinations', () => {
  assert.equal(applicationIdentity.name, 'Artifact Toolkit');
  assert.deepEqual(primaryNavigation.map(({ label, href }) => [label, href]), [['Artifacts', '/'], ['Workflows', '/workflows'], ['Diagnostics', '/diagnostics']]);
  assert.equal(primaryNavigation.some((item) => item.label === 'Create artifact'), false);
});

test('primary navigation resolves one active product area for nested routes', () => {
  const cases = [
    ['/', 'Artifacts'],
    ['/artifacts/example/edit', 'Artifacts'],
    ['/workflows/runs', 'Workflows'],
    ['/diagnostics', 'Diagnostics'],
  ];
  for (const [path, expected] of cases) {
    const state = primaryNavigationState(path);
    assert.equal(state.filter((item) => item.active).length, 1, path);
    assert.equal(state.find((item) => item.active)?.label, expected, path);
  }
});

test('shared application header renders semantic navigation without duplicate identity', () => {
  const html = renderToStaticMarkup(React.createElement(AppHeader, { login: 'octocat', currentPath: '/diagnostics' }));
  assert.match(html, /<header\b/);
  assert.match(html, /<nav aria-label="Primary"/);
  assert.match(html, /aria-current="page"[^>]*>Diagnostics/);
  assert.equal(textCount(html, 'Artifact Toolkit'), 1);
  assert.equal(textCount(html, 'octocat'), 1);
  assert.match(html, />Sign out/);
  assert.doesNotMatch(html, /Create artifact/);
  for (const button of html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []) assert.doesNotMatch(button, /<a\b/);
  for (const anchor of html.match(/<a[^>]*>[\s\S]*?<\/a>/g) ?? []) assert.doesNotMatch(anchor, /<button\b/);
});

test('artifact operational shells retain shared navigation and the operational state', () => {
  const state = { category: 'github_temporarily_unavailable', title: 'GitHub temporarily unavailable', message: 'Try again later.' };
  for (const currentPath of ['/artifacts/example', '/artifacts/example/edit']) {
    const html = renderToStaticMarkup(React.createElement(ProtectedArtifactShell, { login: 'octocat', currentPath }, React.createElement(OperationalState, { state })));
    assert.match(html, /Artifact Toolkit/);
    assert.match(html, />Artifacts/);
    assert.match(html, />Diagnostics/);
    assert.match(html, /GitHub temporarily unavailable/);
  }
});
