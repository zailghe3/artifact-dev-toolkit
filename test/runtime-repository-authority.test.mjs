import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { DEFAULT_ARTIFACT_ROOT } from '../lib/artifact-contract.ts';
import { brokerRepositoryCredential, signManagedRepositoryAuthorities } from '../lib/runtime-repository-authority.ts';

test('the Runtime GitHub broker limits tokens to live repository identities and admitted capabilities', async () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const env = {
    GITHUB_APP_ID: '123',
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_ARTIFACT_REPOSITORY_OWNER: 'owner',
    GITHUB_ARTIFACT_REPOSITORY_NAME: 'artifacts',
    SESSION_SECRET: 'test-only-worker-session-authority'.repeat(2),
  };
  const scope = { owner: 'owner', repository: 'artifacts', branch: 'main', root: DEFAULT_ARTIFACT_ROOT, installationId: 17, repositoryId: 21 };
  const context = { owner: 'owner', repository: 'code', baseBranch: 'main', environmentKey: 'code', managed: true, installationId: 18, repositoryId: 22 };
  const grants = [];
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      const grant = JSON.parse(init.body);
      grants.push([path, grant]);
      return Response.json({ token: 'short-lived-installation-token', expires_at: new Date(Date.now() + 60_000), permissions: grant.permissions });
    }
    const repository = path.startsWith('/repos/owner/artifacts') ? scope : context;
    if (path.endsWith('/installation')) return Response.json({ id: repository.installationId });
    return Response.json({ id: repository.repositoryId, name: repository.repository, owner: { login: repository.owner } });
  };

  await assert.rejects(brokerRepositoryCredential({ purpose: 'artifacts', context: { ...scope, branch: 'other' } }, env, fetcher), /permission_denied/);
  assert.equal(grants.length, 0);
  await brokerRepositoryCredential({ purpose: 'artifacts', context: scope }, env, fetcher);
  assert.deepEqual(grants.pop(), ['/app/installations/17/access_tokens', { repository_ids: [21], permissions: { contents: 'read' } }]);

  const runId = crypto.randomUUID();
  const { agent: authority } = await signManagedRepositoryAuthorities(
    { id: runId, repositoryContext: scope, managedCodeRepositoryContexts: { agent: context } }, env.SESSION_SECRET,
  );
  const request = { purpose: 'publication', scope, context, runId, authority, capability: 'pull_requests' };
  await assert.rejects(brokerRepositoryCredential({ ...request, context: { ...context, repositoryId: 99 } }, env, fetcher), /permission_denied/);
  await assert.rejects(brokerRepositoryCredential({ ...request, runId: crypto.randomUUID() }, env, fetcher), /permission_denied/);
  assert.equal(grants.length, 0);
  await brokerRepositoryCredential(request, env, fetcher);
  assert.deepEqual(grants, [
    ['/app/installations/17/access_tokens', { repository_ids: [21], permissions: { contents: 'read' } }],
    ['/app/installations/18/access_tokens', { repository_ids: [22], permissions: { contents: 'read' } }],
    ['/app/installations/18/access_tokens', { repository_ids: [22], permissions: { pull_requests: 'write' } }],
  ]);
});
