import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { installTsxHook } from './render-tsx.mjs';
const requireTsx = installTsxHook();
const { AppHeader } = requireTsx('../components/AppHeader.tsx');
const { OperationalState } = requireTsx('../components/OperationalState.tsx');
const { ProtectedArtifactShell } = requireTsx('../components/ProtectedArtifactShell.tsx');
import { applicationIdentity, primaryNavigation, primaryNavigationState } from '../lib/app-navigation.ts';

const textCount = (html, text) => (html.match(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;

test('primary navigation exposes expected route destinations and future-friendly model', () => {
  assert.equal(applicationIdentity.name, 'Artifact Toolkit');
  assert.deepEqual(primaryNavigation.map(({ label, href }) => [label, href]), [['Artifacts', '/'], ['Diagnostics', '/diagnostics']]);
  assert.equal(primaryNavigation.some((item) => item.label === 'Create artifact'), false);
});

test('primary navigation resolves artifact and diagnostics active states', () => {
  assert.deepEqual(primaryNavigationState('/').map(({ label, active }) => [label, active]), [['Artifacts', true], ['Diagnostics', false]]);
  assert.deepEqual(primaryNavigationState('/artifacts/example/edit').map(({ label, active }) => [label, active]), [['Artifacts', true], ['Diagnostics', false]]);
  assert.deepEqual(primaryNavigationState('/diagnostics').map(({ label, active }) => [label, active]), [['Artifacts', false], ['Diagnostics', true]]);
});

test('shared application header renders semantic compact navigation without duplicate identity', () => {
  const html = renderToStaticMarkup(React.createElement(AppHeader, { login: 'octocat', currentPath: '/diagnostics' }));
  assert.match(html, /<header\b/);
  assert.match(html, /<nav aria-label="Primary"/);
  assert.match(html, /aria-current="page"[^>]*>Diagnostics</);
  assert.equal(textCount(html, 'Artifact Toolkit'), 1);
  assert.equal(textCount(html, 'octocat'), 1);
  assert.match(html, />Sign out</);
  assert.doesNotMatch(html, /Create artifact/);
  for (const button of html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []) assert.doesNotMatch(button, /<a\b/);
  for (const anchor of html.match(/<a[^>]*>[\s\S]*?<\/a>/g) ?? []) assert.doesNotMatch(anchor, /<button\b/);
});

test('artifact operational shells retain shared navigation and content', () => {
  const state = { category: 'github_temporarily_unavailable', title: 'GitHub temporarily unavailable', message: 'Try again later.' };
  for (const currentPath of ['/artifacts/example', '/artifacts/example/edit']) {
    const html = renderToStaticMarkup(React.createElement(ProtectedArtifactShell, { login: 'octocat', currentPath }, React.createElement(OperationalState, { state })));
    assert.match(html, /Artifact Toolkit/);
    assert.match(html, />Artifacts</);
    assert.match(html, />Diagnostics</);
    assert.match(html, /GitHub temporarily unavailable/);
  }
});

test('artifact page composition is compact, search-first, and keeps exceptional cache warnings', async () => {
  const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Artifact Library|Find, copy, and fork workday assets fast|Reusable prompts, agents, snippets/);
  assert.match(source, /<h1[^>]*>Artifacts<\/h1>/);
  assert.match(source, /\{artifacts\.length\} artifacts · \{productionCount\} production/);
  assert.match(source, /aria-labelledby="artifacts-heading"[\s\S]*href="\/artifacts\/new"[\s\S]*\+ Create artifact/);
  assert.match(source, /<CatalogueWarning cacheState=\{catalogue\.cacheState\} \/>\s*\n\s*<ArtifactSearch artifacts=\{artifacts\} \/>/);
  assert.doesNotMatch(source, /CatalogueRefresh/);
  assert.match(source, /Catalogue data may be stale\.[\s\S]*View Diagnostics/);
  assert.match(source, /Catalogue caching is temporarily unavailable\.[\s\S]*View Diagnostics/);
});

test('diagnostics owns catalogue refresh controls and accessible feedback', async () => {
  const diagnostics = await readFile(new URL('../app/diagnostics/page.tsx', import.meta.url), 'utf8');
  const refresh = await readFile(new URL('../components/CatalogueRefresh.tsx', import.meta.url), 'utf8');
  const health = await readFile(new URL('../components/CatalogueHealthSummary.tsx', import.meta.url), 'utf8');
  assert.match(diagnostics, /Catalogue health/);
  assert.match(health, /Catalogue state:/);
  assert.match(health, /DiagnosticStatusBadge/);
  assert.match(health, /LocalizedTime/);
  assert.doesNotMatch(health, /stableRefreshTime/);
  assert.equal((`${diagnostics}\n${health}`.match(/Last successful refresh:/g) ?? []).length, 1);
  assert.match(diagnostics, /<CatalogueRefreshControls/);
  assert.match(refresh, /Refresh/);
  assert.match(refresh, /Full rebuild/);
  assert.match(refresh, /router\.refresh\(\)/);
  assert.match(refresh, /Refresh failed\. The current catalogue was not replaced\./);
  assert.match(refresh, /role="alert"/);
});
