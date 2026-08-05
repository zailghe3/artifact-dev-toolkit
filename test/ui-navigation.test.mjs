import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { applicationIdentity, primaryNavigation, primaryNavigationState } from '../lib/app-navigation.ts';

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

test('shared application header uses semantic navigation without nested controls', async () => {
  const source = await readFile(new URL('../components/AppHeader.tsx', import.meta.url), 'utf8');
  assert.match(source, /<header\b/);
  assert.match(source, /<nav aria-label="Primary"/);
  assert.match(source, /aria-current=\{item\.active \? "page" : undefined\}/);
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /whitespace-nowrap/);
  assert.doesNotMatch(source, /role="tab"|<button[\s\S]*<Link|<Link[\s\S]*<button/);
  assert.equal((source.match(/applicationIdentity\.name/g) ?? []).length, 1);
  assert.doesNotMatch(source, /Create artifact/);
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
  assert.match(diagnostics, /Catalogue health/);
  assert.match(diagnostics, /Catalogue state:/);
  assert.match(diagnostics, /<CatalogueRefresh/);
  assert.match(refresh, /Refresh/);
  assert.match(refresh, /Full rebuild/);
  assert.match(refresh, /router\.refresh\(\)/);
  assert.match(refresh, /Refresh failed\. The current catalogue was not replaced\./);
  assert.match(refresh, /role="alert"/);
});
