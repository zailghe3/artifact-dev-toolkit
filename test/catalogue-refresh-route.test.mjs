import assert from 'node:assert/strict';
import test from 'node:test';
import { handleCatalogueRefresh } from '../lib/catalogue-refresh-route-handler.ts';
import { ArtifactRepositoryUnavailableError } from '../lib/artifact-repository.ts';

const access = { repositoryId: 1, owner: 'owner', repo: 'repo' };
const result = { artifacts: [], revision: 'aaaaaaaa', refreshedAt: '2026-08-02T00:00:00.000Z', cacheState: 'refreshed' };
function deps(refresh = async () => result, authorize = async () => ({ access })) { return { authorize, refresh }; }
function request(body) { return new Request('https://example.test/api/artifacts/refresh', { method: 'POST', ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }) }); }
function assertPrivate(response) { assert.match(response.headers.get('cache-control'), /no-store/); }

for (const [name, body, expectedFull] of [['empty body', undefined, false], ['empty object', '{}', false], ['full rebuild', '{"full":true}', true]]) test(`refresh accepts ${name}`, async () => {
  let full; const response = await handleCatalogueRefresh(request(body), deps(async (_access, value) => { full = value; return result; })); assert.equal(response.status, 200); assert.equal(full, expectedFull); assertPrivate(response);
});
for (const [name, body] of [['malformed JSON', '{'], ['wrong property type', '{"full":"yes"}'], ['unknown property', '{"other":true}']]) test(`refresh rejects ${name}`, async () => {
  const response = await handleCatalogueRefresh(request(body), deps()); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'Invalid refresh request', code: 'validation_failed' }); assertPrivate(response);
});
test('refresh returns authentication and authorization responses before catalogue work', async () => {
  for (const status of [401, 403]) { let called = false; const denied = new Response('{}', { status }); const response = await handleCatalogueRefresh(request('{}'), deps(async () => { called = true; return result; }, async () => denied)); assert.equal(response, denied); assert.equal(called, false); }
});
test('refresh exposes cache degradation safely and with no-store headers', async () => {
  const response = await handleCatalogueRefresh(request('{}'), deps(async () => ({ ...result, cacheState: 'degraded' }))); assert.equal(response.status, 200); assert.equal((await response.json()).cacheState, 'degraded'); assertPrivate(response);
});
test('refresh maps temporary GitHub failure without raw upstream data', async () => {
  const response = await handleCatalogueRefresh(request('{}'), deps(async () => { throw new ArtifactRepositoryUnavailableError(503); })); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'Artifact repository temporarily unavailable', code: 'repository_unavailable' }); assertPrivate(response);
});
test('local file refresh is explicitly unsupported without KV access', async () => {
  const response = await handleCatalogueRefresh(request('{}'), deps(async () => undefined)); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'refresh_unsupported'); assertPrivate(response);
});
