import assert from 'node:assert/strict';
import test from 'node:test';
import { ArtifactCatalogueService, MemoryCatalogueCache, catalogueFreshnessSeconds } from '../lib/artifact-catalogue.ts';
import { ArtifactRepositoryAccessError, ArtifactRepositoryContentError, ArtifactRepositoryUnavailableError } from '../lib/artifact-repository.ts';

const identity = { repositoryId: 42, owner: 'acme', repository: 'private-artifacts', branch: 'main', root: 'artifacts' };
const artifact = (id = 'one') => ({ id, title: `Title ${id}`, type: 'prompt', status: 'production', tags: [], aliases: [], body: `private body ${id}`, excerpt: `private body ${id}`, path: `artifacts/prompts/${id}.md` });
function repository(revision = 'aaaaaaaa', artifacts = [artifact()]) {
  const calls = { revisions: 0, catalogues: 0 };
  return { calls,
    async getBaseRevision() { calls.revisions++; return revision; },
    async loadCatalogue(requested) { calls.catalogues++; return { revision: requested, artifacts, fileShas: Object.fromEntries(artifacts.map((item) => [item.id, `${item.id === 'one' ? 'b' : 'c'}`.repeat(8)])) }; },
  };
}
function service(repo, cache, now, logger) { return new ArtifactCatalogueService({ repository: repo, cache, identity, now: () => new Date(now.value), freshnessSeconds: 300, logger }); }

test('first load publishes a complete snapshot and a fresh repeat avoids GitHub', async () => {
  const cache = new MemoryCatalogueCache(); const repo = repository(); const now = { value: '2026-08-02T00:00:00.000Z' }; const catalogue = service(repo, cache, now);
  const first = await catalogue.list(); const repeat = await catalogue.list();
  assert.equal(first.cacheState, 'refreshed'); assert.equal(repeat.cacheState, 'fresh');
  assert.deepEqual(repo.calls, { revisions: 1, catalogues: 1 });
  assert.ok([...cache.values.keys()].some(key => key.endsWith(':current')));
});

test('stale unchanged revision refreshes metadata without a catalogue download', async () => {
  const cache = new MemoryCatalogueCache(); const repo = repository(); const now = { value: '2026-08-02T00:00:00.000Z' }; const catalogue = service(repo, cache, now);
  await catalogue.list(); now.value = '2026-08-02T00:06:00.000Z';
  const result = await catalogue.list(); assert.equal(result.cacheState, 'refreshed'); assert.equal(result.refreshedAt, now.value); assert.equal(repo.calls.catalogues, 1); assert.equal(repo.calls.revisions, 2);
});

test('changed revision publishes a new snapshot and detail SHA belongs to it', async () => {
  const cache = new MemoryCatalogueCache(); const now = { value: '2026-08-02T00:00:00.000Z' }; let revision = 'aaaaaaaa';
  const base = repository(); base.getBaseRevision = async () => (base.calls.revisions++, revision); base.loadCatalogue = async requested => (base.calls.catalogues++, { revision: requested, artifacts: [artifact(requested)], fileShas: { [requested]: requested === 'aaaaaaaa' ? 'bbbbbbbb' : 'dddddddd' } });
  const catalogue = service(base, cache, now); await catalogue.list(); revision = 'cccccccc'; now.value = '2026-08-02T00:06:00.000Z'; await catalogue.list();
  const detail = await catalogue.findByIdWithRevision('cccccccc'); assert.equal(detail.currentFileSha, 'dddddddd'); assert.equal(detail.artifact.id, 'cccccccc');
  assert.ok([...cache.values.keys()].some(key => key.includes('snapshot:aaaaaaaa'))); assert.ok([...cache.values.keys()].some(key => key.includes('snapshot:cccccccc')));
});

test('temporary failures serve marked stale but access and content failures fail closed', async () => {
  for (const [error, stale] of [[new ArtifactRepositoryUnavailableError(429), true], [new ArtifactRepositoryAccessError(), false], [new ArtifactRepositoryContentError(), false]]) {
    const cache = new MemoryCatalogueCache(); const now = { value: '2026-08-02T00:00:00.000Z' }; const repo = repository(); const catalogue = service(repo, cache, now); await catalogue.list(); now.value = '2026-08-02T00:06:00.000Z'; repo.getBaseRevision = async () => { throw error; };
    if (stale) { const result = await catalogue.list(); assert.equal(result.cacheState, 'stale'); assert.equal(result.staleReason, 'rate_limited'); }
    else await assert.rejects(catalogue.list(), error.constructor);
  }
});

test('malformed cache fails closed and refreshes without logging bodies', async () => {
  const cache = new MemoryCatalogueCache(); const repo = repository(); const now = { value: '2026-08-02T00:00:00.000Z' }; const messages = []; const logger = { info: value => messages.push(value), error: value => messages.push(value) };
  await service(repo, cache, now, logger).list(); const pointer = [...cache.values.keys()].find(key => key.endsWith(':current')); cache.values.set(pointer, JSON.stringify({ body: 'TOP SECRET artifact body' }));
  await service(repo, cache, now, logger).list(); assert.equal(repo.calls.catalogues, 2); assert.ok(messages.some(value => value.includes('cache_corruption'))); assert.ok(messages.every(value => !value.includes('TOP SECRET')));
});

test('manual full refresh rebuilds and concurrent requests share one flight', async () => {
  const cache = new MemoryCatalogueCache(); const repo = repository(); const now = { value: '2026-08-02T00:00:00.000Z' }; let release; const gate = new Promise(resolve => { release = resolve; }); const original = repo.loadCatalogue; repo.loadCatalogue = async revision => { await gate; return original.call(repo, revision); };
  const catalogue = service(repo, cache, now); const first = catalogue.list({ force: true, full: true, manual: true }); const second = catalogue.list({ force: true }); release();
  assert.deepEqual(await first, await second); assert.equal(repo.calls.catalogues, 1);
});

test('failed chunk write never publishes a pointer over the last known good snapshot', async () => {
  const cache = new MemoryCatalogueCache(); const now = { value: '2026-08-02T00:00:00.000Z' }; await service(repository(), cache, now).list(); const pointerKey = [...cache.values.keys()].find(key => key.endsWith(':current')); const oldPointer = cache.values.get(pointerKey);
  const originalPut = cache.put.bind(cache); cache.put = async (key, value) => { if (key.includes('snapshot:cccccccc:chunk')) throw new Error('storage unavailable'); return originalPut(key, value); };
  now.value = '2026-08-02T00:06:00.000Z'; await assert.rejects(service(repository('cccccccc'), cache, now).list()); assert.equal(cache.values.get(pointerKey), oldPointer);
});

test('freshness override is bounded and invalid values use the default', () => {
  assert.equal(catalogueFreshnessSeconds('1'), 30); assert.equal(catalogueFreshnessSeconds('99999'), 3600); assert.equal(catalogueFreshnessSeconds('nope'), 300);
});
