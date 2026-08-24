import test from 'node:test';
import assert from 'node:assert/strict';
import { InstallationCredentialError, mintInstallationToken } from '../lib/github-app.ts';
import { ArtifactWritePermissionError, GitHubArtifactRepository } from '../lib/artifact-repository.ts';

const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const permissionFor = capability => capability === 'read' ? { contents: 'read' } : capability === 'write' ? { contents: 'write' } : { contents: 'write', pullRequests: 'write' };

test('installation tokens request the exact repository and least capability permissions', async () => {
  const requests = [];
  for (const capability of ['read', 'write']) {
    const credential = await mintInstallationToken(77, 99, 'app-jwt-secret', capability, async (_url, init) => {
      requests.push({ authorization: init.headers.authorization, body: JSON.parse(init.body) });
      const requested = JSON.parse(init.body).permissions;
      return json({ token: `installation-token-${capability}`, expires_at: '2026-08-02T18:00:00Z', permissions: requested, repositories: [{ id: 99 }] });
    });
    assert.deepEqual(credential.permissions, permissionFor(capability));
    assert.equal(JSON.stringify(credential).includes('app-jwt-secret'), false);
  }
  assert.deepEqual(requests.map(({ body }) => body), [
    { repository_ids: [99], permissions: { contents: 'read' } },
    { repository_ids: [99], permissions: { contents: 'write' } },
  ]);
});

test('installation credential failures are precise and contain only safe metadata', async () => {
  for (const [status, category] of [[401, 'authentication_failed'], [403, 'installation_missing'], [404, 'installation_missing'], [422, 'capability_request_rejected'], [429, 'rate_limited'], [500, 'temporarily_unavailable'], [418, 'request_failed']]) {
    await assert.rejects(mintInstallationToken(77, 99, 'authorization-secret', 'write', async () => new Response('raw-private-body', { status })), error => {
      assert.ok(error instanceof InstallationCredentialError); assert.equal(error.category, category); assert.equal(error.status, status); assert.equal(error.capability, 'write');
      assert.doesNotMatch(JSON.stringify(error), /raw-private-body|authorization-secret/); return true;
    });
  }
  await assert.rejects(mintInstallationToken(77, 99, 'secret', 'write', async () => { throw new Error('network private detail'); }), error => error.category === 'temporarily_unavailable' && error.status === undefined);
  await assert.rejects(mintInstallationToken(77, 99, 'secret', 'write', async () => new Response('{bad', { status: 200 })), error => error.category === 'malformed_response');
  await assert.rejects(mintInstallationToken(77, 99, 'secret', 'write', async () => json({ permissions: permissionFor('write') })), error => error.category === 'malformed_response');
});

test('successful credentials retain absent permissions for explicit denial classification', async () => {
  const credential = await mintInstallationToken(77, 99, 'secret', 'write', async () => json({ token: 'returned-secret', permissions: { contents: 'write' } }));
  assert.deepEqual(credential.permissions, { contents: 'write' });
});

test('repository capabilities are independently memoized and validated before writes', async () => {
  const requested = [];
  const calls = [];
  const repository = new GitHubArtifactRepository({
    owner: 'owner', repo: 'repo', branch: 'main', rootPath: 'artifacts',
    credentialProvider: async capability => {
      requested.push(capability);
      return { token: `secret-${capability}`, permissions: permissionFor(capability) };
    },
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/git/trees/')) return json({ truncated: false, tree: [] });
      const path = decodeURIComponent(String(url).split('/contents/')[1]);
      return json({ content: { path, sha: 'blob' }, commit: { sha: 'commit', html_url: 'https://github.com/owner/repo/commit/commit' } });
    },
    logger: { info() {}, error() {} },
  });
  await repository.list();
  await repository.list();
  await repository.create({ metadata: { id: 'new', title: 'New', type: 'prompt', tags: [], aliases: [] }, body: 'Body', actorLogin: 'octocat' });
  assert.deepEqual(requested, ['read', 'write']);
  assert.equal(calls.filter(call => call.init.method === 'PUT').length, 1);
  assert.equal(JSON.stringify(calls).includes('secret-read'), true);
  assert.equal(JSON.stringify(calls).includes('secret-write'), true);
});

test('insufficient write permission fails before repository mutation',async()=>{let fetches=0;const repository=new GitHubArtifactRepository({owner:'owner',repo:'repo',branch:'main',rootPath:'artifacts',credentialProvider:async()=>({token:'secret',permissions:{contents:'read'}}),fetch:async()=>{fetches++;throw new Error('must not fetch')},logger:{info(){},error(){}}});await assert.rejects(repository.create({metadata:{id:'new',title:'New',type:'prompt',tags:[],aliases:[]},body:'Body',actorLogin:'octocat'}),ArtifactWritePermissionError);assert.equal(fetches,0)});
