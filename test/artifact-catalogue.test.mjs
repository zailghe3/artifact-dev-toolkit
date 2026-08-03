import assert from 'node:assert/strict';
import test from 'node:test';
import { ArtifactCatalogueService, MemoryCatalogueCache, catalogueFreshnessSeconds } from '../lib/artifact-catalogue.ts';
import { ArtifactRepositoryAccessError, ArtifactRepositoryConfigurationError, ArtifactRepositoryContentError, ArtifactRepositoryUnavailableError } from '../lib/artifact-repository.ts';

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
  assert.deepEqual(repo.calls, { revisions: 3, catalogues: 1 });
  assert.ok([...cache.values.keys()].some(key => key.endsWith(':current')));
});

test('stale unchanged revision refreshes metadata without a catalogue download', async () => {
  const cache = new MemoryCatalogueCache(); const repo = repository(); const now = { value: '2026-08-02T00:00:00.000Z' }; const catalogue = service(repo, cache, now);
  await catalogue.list(); now.value = '2026-08-02T00:06:00.000Z';
  const result = await catalogue.list(); assert.equal(result.cacheState, 'refreshed'); assert.equal(result.refreshedAt, now.value); assert.equal(repo.calls.catalogues, 1); assert.equal(repo.calls.revisions, 6);
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
  now.value = '2026-08-02T00:06:00.000Z'; const result = await service(repository('cccccccc'), cache, now).list(); assert.equal(result.cacheState, 'degraded'); assert.equal(cache.values.get(pointerKey), oldPointer);
});

test('freshness override is bounded and invalid values use the default', () => {
  assert.equal(catalogueFreshnessSeconds('1'), 30); assert.equal(catalogueFreshnessSeconds('99999'), 3600); assert.equal(catalogueFreshnessSeconds('nope'), 300);
});

test('KV pointer read failure loads GitHub and returns fresh degraded content', async () => {
  const base = new MemoryCatalogueCache(); const repo = repository(); const now = { value: '2026-08-02T00:00:00.000Z' };
  const cache = { ...base, get: async key => { if (key.endsWith(':current')) throw new Error('KV token secret'); return base.get(key); }, put: base.put.bind(base), delete: base.delete.bind(base) };
  const result = await service(repo, cache, now).list(); assert.equal(result.cacheState, 'degraded'); assert.equal(result.artifacts.length, 1); assert.equal(repo.calls.catalogues, 1);
});

test('KV publication failure returns validated GitHub content as degraded', async () => {
  const base = new MemoryCatalogueCache(); const repo = repository(); const now = { value: '2026-08-02T00:00:00.000Z' };
  const cache = { get: base.get.bind(base), delete: base.delete.bind(base), put: async key => { if (key.includes(':snapshot:')) throw new Error('rate limited'); } };
  const result = await service(repo, cache, now).list(); assert.equal(result.cacheState, 'degraded'); assert.equal(result.revision, 'aaaaaaaa');
});

test('invalidation generation prevents a refresh started earlier from publishing', async () => {
  const cache = new MemoryCatalogueCache(); const repo = repository(); const now = { value: '2026-08-02T00:00:00.000Z' }; let release; const gate = new Promise(resolve => { release = resolve; });
  const original = repo.loadCatalogue; repo.loadCatalogue = async revision => { const loaded = await original.call(repo, revision); await gate; return loaded; };
  const refreshing = service(repo, cache, now); const pending = refreshing.list({ force: true, full: true }); await new Promise(resolve => setTimeout(resolve, 0));
  await new ArtifactCatalogueService({ repository: repo, cache, identity }).invalidate(); release(); const result = await pending;
  assert.equal(result.cacheState, 'degraded'); assert.equal([...cache.values.keys()].some(key => key.endsWith(':current')), false);
});

test('detail uses the exact resolved snapshot without rereading a changed pointer', async () => {
  const cache = new MemoryCatalogueCache(); const now = { value: '2026-08-02T00:00:00.000Z' }; const initial = service(repository(), cache, now); await initial.list();
  let pointerReads = 0; const wrapped = { put: cache.put.bind(cache), delete: cache.delete.bind(cache), get: async key => { if (key.endsWith(':current') && ++pointerReads > 1) return JSON.stringify({ invalid: true }); return cache.get(key); } };
  const detail = await service(repository(), wrapped, now).findByIdWithRevision('one'); assert.equal(detail.artifact.id, 'one'); assert.equal(detail.currentFileSha, 'bbbbbbbb'); assert.equal(pointerReads, 1);
});

test('a queued full rebuild is not downgraded by an ordinary refresh', async () => {
  const cache = new MemoryCatalogueCache(); const repo = repository(); const now = { value: '2026-08-02T00:00:00.000Z' }; let release; const gate = new Promise(resolve => { release = resolve; }); let checks = 0;
  repo.getBaseRevision = async () => { checks++; if (checks === 1) await gate; return 'aaaaaaaa'; };
  const catalogue = service(repo, cache, now); const ordinary = catalogue.list({ force: true }); await new Promise(resolve => setTimeout(resolve, 0)); const full = catalogue.list({ force: true, full: true, manual: true }); release(); await ordinary; await full;
  assert.equal(repo.calls.catalogues, 2); assert.equal(checks, 6);
});

test('duplicate full rebuilds share one full-strength flight', async () => {
  const cache = new MemoryCatalogueCache(); const repo = repository(); const now = { value: '2026-08-02T00:00:00.000Z' }; const catalogue = service(repo, cache, now);
  await Promise.all([catalogue.list({ force: true, full: true }), catalogue.list({ force: true, full: true })]); assert.equal(repo.calls.catalogues, 1);
});

test('an old same-revision pointer does not masquerade as a competing publication', async () => {
  const cache = new MemoryCatalogueCache(); const now = { value: '2026-08-02T00:00:00.000Z' }; await service(repository(), cache, now).list(); const pointerKey = [...cache.values.keys()].find(key => key.endsWith(':current')); const oldPointer = cache.values.get(pointerKey);
  now.value = '2026-08-02T00:06:00.000Z'; const contended = { get: cache.get.bind(cache), delete: cache.delete.bind(cache), put: async key => { if (key.includes(':snapshot:')) throw new Error('KV rate limit'); return cache.put(key, '{}'); } };
  const result = await service(repository(), contended, now).list({ force: true, full: true }); assert.equal(result.cacheState, 'degraded'); assert.equal(cache.values.get(pointerKey), oldPointer);
});

test('a genuine newer competing publication for the current generation is accepted', async () => {
  const cache = new MemoryCatalogueCache(); const competingNow = { value: '2026-08-02T00:02:00.000Z' }; await service(repository(), cache, competingNow).list();
  const attemptedNow = { value: '2026-08-02T00:01:00.000Z' }; const contended = { get: cache.get.bind(cache), delete: cache.delete.bind(cache), put: async key => { if (key.includes(':snapshot:')) throw new Error('KV contention'); return cache.put(key, '{}'); } };
  const result = await service(repository(), contended, attemptedNow).list({ force: true, full: true }); assert.equal(result.cacheState, 'refreshed');
});

test('a competing pointer with an obsolete generation is rejected', async () => {
  const cache = new MemoryCatalogueCache(); const now = { value: '2026-08-02T00:00:00.000Z' }; await service(repository(), cache, now).list(); const generationKey = [...cache.values.keys()].find(key => key.endsWith(':generation')) ?? [...cache.values.keys()].find(key => key.endsWith(':current')).replace(':current', ':generation');
  await cache.put(generationKey, JSON.stringify({ schemaVersion: 1, generation: 'new-generation' })); now.value = '2026-08-02T00:06:00.000Z'; const contended = { get: cache.get.bind(cache), delete: cache.delete.bind(cache), put: async key => { if (key.includes(':snapshot:')) throw new Error('KV contention'); return cache.put(key, '{}'); } };
  const result = await service(repository(), contended, now).list({ force: true, full: true }); assert.equal(result.cacheState, 'degraded');
});

test('failed invalidation marks the isolate dirty so the old pointer is not reused', async () => {
  const cache = new MemoryCatalogueCache(); const now = { value: '2026-08-02T00:00:00.000Z' }; await service(repository(), cache, now).list();
  const failing = { get: cache.get.bind(cache), delete: cache.delete.bind(cache), put: async key => { if (key.endsWith(':generation')) throw new Error('KV unavailable'); return cache.put(key, '{}'); } };
  const invalidated = await new ArtifactCatalogueService({ repository: repository(), cache: failing, identity }).invalidate(); assert.equal(invalidated, false);
  const changed = repository('cccccccc'); const result = await service(changed, cache, now).list(); assert.equal(result.revision, 'cccccccc'); assert.equal(changed.calls.catalogues, 1);
});

test('chunk read outage is cache degradation rather than corruption', async () => {
  const cache = new MemoryCatalogueCache(); const now = { value: '2026-08-02T00:00:00.000Z' }; await service(repository(), cache, now).list(); const logs = []; const wrapped = { put: cache.put.bind(cache), delete: cache.delete.bind(cache), get: async key => { if (key.includes(':chunk:')) throw new Error('secret cached value'); return cache.get(key); } };
  const result = await service(repository(), wrapped, now, { info: value => logs.push(value), error: value => logs.push(value) }).list(); assert.equal(result.cacheState, 'degraded'); assert.ok(logs.some(value => value.includes('cache_read_failure') && value.includes('chunk_read'))); assert.ok(logs.every(value => !value.includes('cache_corruption') && !value.includes('secret cached value') && !value.includes('private body')));
});

test('malformed chunk is classified as corruption without logging cached content', async () => {
  const cache = new MemoryCatalogueCache(); const now = { value: '2026-08-02T00:00:00.000Z' }; await service(repository(), cache, now).list(); const chunkKey = [...cache.values.keys()].find(key => key.includes(':chunk:')); cache.values.set(chunkKey, JSON.stringify({ body: 'private body secret' })); const logs = [];
  await service(repository(), cache, now, { info: value => logs.push(value), error: value => logs.push(value) }).list(); assert.ok(logs.some(value => value.includes('cache_corruption'))); assert.ok(logs.every(value => !value.includes('private body secret')));
});

test('eventually consistent pointer visibility cannot leave revision A newly fresh after revision B invalidates', async () => {
  class EventuallyConsistentCache {
    visible = new Map(); pending = new Map(); pendingDeletes = new Set(); hide = { generation: true, pointer: true, chunk: false }; onPointerPut;
    kind(key) { return key.endsWith(':generation') ? 'generation' : key.endsWith(':current') ? 'pointer' : 'chunk'; }
    async get(key) { return this.visible.get(key) ?? null; }
    async put(key, value) { const kind = this.kind(key); if (this.hide[kind]) this.pending.set(key, value); else this.visible.set(key, value); if (kind === 'pointer') await this.onPointerPut?.(); }
    async delete(key) { if (this.hide[this.kind(key)]) this.pendingDeletes.add(key); else this.visible.delete(key); }
    flush(kind) { for (const [key, value] of this.pending) if (this.kind(key) === kind) { this.visible.set(key, value); this.pending.delete(key); } for (const key of this.pendingDeletes) if (this.kind(key) === kind) { this.visible.delete(key); this.pendingDeletes.delete(key); } }
  }
  const cache = new EventuallyConsistentCache(); let revision = 'aaaaaaaa'; const repo = repository(); repo.getBaseRevision = async () => revision; const first = new ArtifactCatalogueService({ repository: repo, cache, identity }); const second = new ArtifactCatalogueService({ repository: repo, cache, identity });
  cache.onPointerPut = async () => { cache.onPointerPut = undefined; revision = 'cccccccc'; await second.invalidate(); };
  const result = await first.list({ force: true, full: true }); assert.equal(result.cacheState, 'degraded'); cache.flush('pointer'); assert.equal([...cache.visible.keys()].some(key => key.endsWith(':current')), false);
});

test('own pointer is never accepted as a competing publication when put reports failure', async () => {
  const cache = new MemoryCatalogueCache(); const wrapped = { get: cache.get.bind(cache), delete: cache.delete.bind(cache), put: async (key, value) => { await cache.put(key, value); if (key.endsWith(':current')) throw new Error('uncertain write'); } };
  const result = await service(repository(), wrapped, { value: '2026-08-02T00:00:00.000Z' }).list(); assert.equal(result.cacheState, 'degraded');
});

test('final repository verification errors retain repository classification', async () => {
  for (const error of [new ArtifactRepositoryAccessError(), new ArtifactRepositoryConfigurationError('bad config'), new ArtifactRepositoryContentError()]) {
    const cache = new MemoryCatalogueCache(); const repo = repository(); let calls = 0; repo.getBaseRevision = async () => { calls++; if (calls === 3) throw error; return 'aaaaaaaa'; };
    await assert.rejects(service(repo, cache, { value: '2026-08-02T00:00:00.000Z' }).list(), error.constructor); assert.equal([...cache.values.keys()].some(key => key.endsWith(':current')), false);
  }
});

test('temporary final repository verification failure returns degraded without cache misclassification', async () => {
  const cache = new MemoryCatalogueCache(); const repo = repository(); const logs = []; let calls = 0; repo.getBaseRevision = async () => { calls++; if (calls === 3) throw new ArtifactRepositoryUnavailableError(503); return 'aaaaaaaa'; };
  const result = await service(repo, cache, { value: '2026-08-02T00:00:00.000Z' }, { info: value => logs.push(value), error: value => logs.push(value) }).list(); assert.equal(result.cacheState, 'degraded'); assert.ok(logs.some(value => value.includes('repository_unavailable'))); assert.ok(logs.every(value => !value.includes('cache_publication_failure'))); assert.equal([...cache.values.keys()].some(key => key.endsWith(':current')), false);
});

test('detail metadata and SHA come from one fresh resolved catalogue', async () => {
  const cache = new MemoryCatalogueCache(); const now = { value: '2026-08-02T00:00:00.000Z' }; const detail = await service(repository(), cache, now).findByIdWithRevision('one'); assert.equal(detail.currentFileSha, 'bbbbbbbb'); assert.deepEqual(detail.catalogue, { revision: 'aaaaaaaa', refreshedAt: now.value, cacheState: 'refreshed', cacheEnabled: true });
});

test('detail metadata identifies stale and degraded results separately', async () => {
  const now = { value: '2026-08-02T00:00:00.000Z' }; const staleCache = new MemoryCatalogueCache(); const staleRepo = repository(); const staleService = service(staleRepo, staleCache, now); await staleService.list(); now.value = '2026-08-02T00:06:00.000Z'; staleRepo.getBaseRevision = async () => { throw new ArtifactRepositoryUnavailableError(503); }; const stale = await staleService.findByIdWithRevision('one'); assert.equal(stale.catalogue.cacheState, 'stale');
  const degradedCache = new MemoryCatalogueCache(); degradedCache.get = async () => { throw new Error('KV down'); }; const degraded = await service(repository(), degradedCache, now).findByIdWithRevision('one'); assert.equal(degraded.catalogue.cacheState, 'degraded');
});
