import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLifecyclePreview } from '../lib/lifecycle-preview-route-handler.ts';
const access = { owner: 'o', repo: 'r', repositoryId: 1 };
const artifact = { id: 'draft-one', title: 'Stored', type: 'prompt', status: 'draft', tags: [], aliases: [], body: 'old', excerpt: 'old', path: 'artifacts/prompts/draft-one.md' };
const auth = async () => ({ access, session: { login: 'octocat' } });
const req = (body) => new Request('https://example.test/preview', { method: 'POST', body: JSON.stringify(body) });
test('creation lifecycle preview is authenticated, private, normalized, rendered, and mutation free', async () => {
  let authorized = 0; const response = await handleLifecyclePreview(req({ metadata: { ...artifact, id: ' new-id ', title: ' New ', tags: [' one ', 'one'], body: undefined, excerpt: undefined, path: undefined }, body: '**safe**<script>bad()</script>' }), undefined, { authorize: async () => { authorized++; return auth(); } });
  const value = await response.json(); assert.equal(authorized, 1); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0'); assert.equal(value.metadata.id, 'new-id'); assert.deepEqual(value.metadata.tags, ['one']); assert.match(value.bodyHtml, /<strong>safe<\/strong>/); assert.doesNotMatch(value.bodyHtml, /<script>/);
});
test('editing preview validates exact revision and immutable lifecycle metadata without writes', async () => {
  let loads = 0; const dependencies = { authorize: auth, loadArtifact: async () => { loads++; return { artifact, currentFileSha: 'abcdefgh' }; } };
  assert.equal((await handleLifecyclePreview(req({ metadata: artifact, body: 'new', currentFileSha: 'stale' }), artifact.id, dependencies)).status, 409);
  assert.equal((await handleLifecyclePreview(req({ metadata: { ...artifact, type: 'agent' }, body: 'new', currentFileSha: 'abcdefgh' }), artifact.id, dependencies)).status, 400);
  assert.equal(loads, 2);
});
test('preview authorization occurs before parsing or loading', async () => { let loads = 0; const denied = new Response('denied', { status: 401 }); const response = await handleLifecyclePreview(new Request('https://x', { method: 'POST', body: '{' }), 'x', { authorize: async () => denied, loadArtifact: async () => { loads++; return undefined; } }); assert.equal(response, denied); assert.equal(loads, 0); });
