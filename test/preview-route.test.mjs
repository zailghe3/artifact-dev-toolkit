import test from 'node:test';
import assert from 'node:assert/strict';
import { handleVariationPreview } from '../lib/preview-route-handler.ts';

const access = { owner: 'owner', repo: 'repo', repositoryId: 1, installationId: 2, installationTokenProvider: async () => 'secret' };
const source = { id: 'source', title: 'Source', type: 'prompt', status: 'production', tags: ['writing'], aliases: ['start'], body: 'old', excerpt: 'old', path: 'artifacts/prompts/source.md' };
const dependencies = (overrides = {}) => ({ authorize: async () => ({ access, session: { login: 'octocat' } }), loadArtifact: async () => source, ...overrides });
const request = (body) => new Request('https://example.test/api/artifacts/source/variation/preview', { method: 'POST', body });

test('variation preview uses unsaved values and draft rules without a write', async () => {
  let loads = 0;
  const response = await handleVariationPreview(request(JSON.stringify({ title: 'Unsaved', body: '**new**' })), 'source', dependencies({ loadArtifact: async () => { loads++; return source; } }));
  const value = await response.json(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(loads, 1); assert.equal(value.metadata.title, 'Unsaved'); assert.equal(value.metadata.status, 'draft'); assert.equal(value.metadata.sourceId, 'source'); assert.deepEqual(value.metadata.tags, ['writing', 'variation']); assert.deepEqual(value.metadata.aliases, ['start']); assert.match(value.bodyHtml, /<strong>new<\/strong>/);
});

test('variation preview rejects malformed input and does not execute raw HTML', async () => {
  assert.equal((await handleVariationPreview(request('{'), 'source', dependencies())).status, 400);
  const response = await handleVariationPreview(request(JSON.stringify({ body: '<script>alert(1)</script><img onerror="alert(2)">' })), 'source', dependencies());
  const value = await response.json(); assert.doesNotMatch(value.bodyHtml, /script|onerror|alert/);
});
