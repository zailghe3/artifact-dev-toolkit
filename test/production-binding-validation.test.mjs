import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateProductionBindings } from '../scripts/validate-production-bindings.mjs';

async function config(kv_namespaces) { const dir = await mkdtemp(path.join(tmpdir(), 'bindings-')); const file = path.join(dir, 'wrangler.jsonc'); await writeFile(file, JSON.stringify({ kv_namespaces })); return file; }
test('production validation refuses a missing KV id instead of allowing auto-provisioning', async () => { await assert.rejects(validateProductionBindings(await config([{ binding: 'ARTIFACT_CATALOGUE_CACHE' }])), /refusing automatic provisioning/); });
test('production validation accepts only a manually supplied non-empty KV id', async () => { assert.equal(await validateProductionBindings(await config([{ binding: 'ARTIFACT_CATALOGUE_CACHE', id: 'real-public-id' }])), 'real-public-id'); });
