import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ArtifactDuplicateError, ArtifactRepositoryConfigurationError, ArtifactRepositoryUnavailableError,
  ArtifactSecretRejectedError, ArtifactWritePermissionError, ArtifactWriteTooLargeError,
} from '../lib/artifact-repository.ts';
import { handleVariationPost } from '../lib/variation-route-handler.ts';

const access = { owner: 'owner', repo: 'repo', repositoryId: 1, installationId: 2, installationCredentialProvider: async (capability) => ({ token: 'credential', permissions: capability === 'read' ? { contents: 'read' } : capability === 'write' ? { contents: 'write' } : { contents: 'write', pullRequests: 'write' } }) };
const session = { login: 'octocat' };
const source = { id: 'source', title: 'Source', type: 'prompt', status: 'production', tags: [], aliases: [], body: 'Body', excerpt: 'Body', path: 'artifacts/prompts/source.md' };
const request = (body) => new Request('https://example.test/api/artifacts/source/variation', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
const authorized = async () => ({ access, session });
const success = { id: 'variation-id', path: 'artifacts/variations/variation-id.md', fileSha: 'file-sha', commitSha: 'commit-sha', commitUrl: 'https://github.com/owner/repo/commit/commit-sha' };

function dependencies(overrides = {}) {
  return { authorize: authorized, loadArtifact: async () => source, persistVariation: async () => success, ...overrides };
}

async function payload(response) { return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') }; }

test('variation route returns authentication and authorization responses before repository work', async () => {
  for (const status of [401, 403]) {
    let loaded = false;
    const response = await handleVariationPost(request('{}'), 'source', dependencies({
      authorize: async () => Response.json({ code: status === 401 ? 'authentication_required' : 'repository_access_denied' }, { status, headers: { 'cache-control': 'private, no-store, max-age=0' } }),
      loadArtifact: async () => { loaded = true; return source; },
    }));
    assert.equal(response.status, status);
    assert.equal(loaded, false);
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  }
});

test('variation route safely rejects malformed JSON and empty bodies', async () => {
  for (const body of ['{', JSON.stringify({ title: 'Title', body: '   ' })]) {
    let loaded = false;
    const result = await payload(await handleVariationPost(request(body), 'source', dependencies({ loadArtifact: async () => { loaded = true; return source; } })));
    assert.deepEqual(result.body, { error: 'Artifact input is invalid', code: 'validation_failed' });
    assert.equal(result.status, 400);
    assert.equal(result.cache, 'private, no-store, max-age=0');
    assert.equal(loaded, false);
  }
});

test('variation route returns a safe missing-source response', async () => {
  const result = await payload(await handleVariationPost(request(JSON.stringify({ body: 'Body' })), 'missing', dependencies({ loadArtifact: async () => undefined })));
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { error: 'Artifact not found', code: 'artifact_not_found' });
});

test('variation route creates through the repository and passes authenticated login attribution', async () => {
  let received;
  const response = await handleVariationPost(request(JSON.stringify({ title: '  Draft  ', body: '  Body  ' })), 'source', dependencies({
    persistVariation: async (...args) => { received = args; return success; },
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), success);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(received[2], 'Body');
  assert.equal(received[3], 'octocat');
  assert.equal(received[4], 'Draft');
});

test('variation route maps typed repository failures without exposing upstream data', async () => {
  const cases = [
    [new ArtifactSecretRejectedError(), 400, 'secret_rejected'],
    [new ArtifactWriteTooLargeError(), 413, 'artifact_too_large'],
    [new ArtifactDuplicateError(), 409, 'duplicate_artifact'],
    [new ArtifactWritePermissionError(), 403, 'write_permission_required'],
    [new ArtifactRepositoryUnavailableError(429), 503, 'repository_unavailable'],
    [new ArtifactRepositoryConfigurationError('private credential'), 500, 'repository_configuration'],
    [new Error('raw upstream body credential exception'), 500, 'internal_error'],
  ];
  for (const [error, status, code] of cases) {
    const result = await payload(await handleVariationPost(request(JSON.stringify({ body: 'Body' })), 'source', dependencies({ persistVariation: async () => { throw error; } })));
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.doesNotMatch(JSON.stringify(result.body), /raw upstream|credential|exception|private credential/);
    assert.equal(result.cache, 'private, no-store, max-age=0');
  }
});

test('variation route safely maps source repository failures', async () => {
  const result = await payload(await handleVariationPost(request(JSON.stringify({ body: 'Body' })), 'source', dependencies({ loadArtifact: async () => { throw new ArtifactRepositoryUnavailableError(503); } })));
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'repository_unavailable');
});
