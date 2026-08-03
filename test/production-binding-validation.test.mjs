import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateProductionBindings } from '../scripts/validate-production-bindings.mjs';

async function config(kv_namespaces) { const dir = await mkdtemp(path.join(tmpdir(), 'bindings-')); const file = path.join(dir, 'wrangler.jsonc'); await writeFile(file, JSON.stringify({ kv_namespaces })); return file; }

test('production validation requires the KV namespaces collection', async () => {
  await assert.rejects(validateProductionBindings(await config(undefined)), /exactly one ARTIFACT_CATALOGUE_CACHE/);
});

test('production validation requires a matching cache binding', async () => {
  await assert.rejects(validateProductionBindings(await config([{ binding: 'OTHER_CACHE', id: 'other-id' }])), /exactly one ARTIFACT_CATALOGUE_CACHE/);
});

test('production validation rejects duplicate cache bindings', async () => {
  await assert.rejects(validateProductionBindings(await config([
    { binding: 'ARTIFACT_CATALOGUE_CACHE', id: 'first-id' },
    { binding: 'ARTIFACT_CATALOGUE_CACHE', id: 'second-id' },
  ])), /exactly one ARTIFACT_CATALOGUE_CACHE/);
});

for (const [description, id] of [['missing', undefined], ['an empty', ''], ['a whitespace-only', '   \n']]) {
  test(`production validation refuses ${description} KV id instead of allowing auto-provisioning`, async () => {
    await assert.rejects(validateProductionBindings(await config([{ binding: 'ARTIFACT_CATALOGUE_CACHE', id }])), /refusing automatic provisioning/);
  });
}

test('production validation accepts a manually supplied non-empty KV id', async () => {
  assert.equal(await validateProductionBindings(await config([{ binding: 'ARTIFACT_CATALOGUE_CACHE', id: 'real-public-id' }])), 'real-public-id');
});

test('production validation accepts the single committed production cache binding', async () => {
  const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const matches = wrangler.kv_namespaces.filter(binding => binding?.binding === 'ARTIFACT_CATALOGUE_CACHE');
  assert.equal(matches.length, 1);
  const validatedId = await validateProductionBindings();
  assert.equal(validatedId, matches[0].id);
  assert.equal(typeof validatedId, 'string');
  assert.ok(validatedId.trim().length > 0);
});
