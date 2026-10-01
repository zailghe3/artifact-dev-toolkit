import test from 'node:test';
import assert from 'node:assert/strict';
import { clearGitHubFreshnessCredentialCacheForTests, createGitHubFreshnessEvidence, GitHubFreshnessEvidenceError } from '../lib/github-freshness-evidence.ts';
import { resolveComponentFromGitHubEvidence } from '../lib/live-component-freshness-evidence.ts';
import { aggregateInfrastructureFreshness, infrastructureFreshnessLabel, infrastructureRevisionLabel } from '../lib/infrastructure-freshness.ts';

const source = { owner: 'zailghe3', repository: 'artifact-dev-toolkit' };

function harness(apiResponse = Response.json({ object: { sha: 'a'.repeat(40) } })) {
  clearGitHubFreshnessCredentialCacheForTests();
  const calls = { installation: [], mint: [], api: [] };
  const evidence = createGitHubFreshnessEvidence(source, {
    identity: () => ({ appId: 'app', privateKey: 'server-private-key' }),
    createJwt: async () => 'server-jwt',
    getInstallation: async (repository, jwt) => { calls.installation.push({ repository, jwt }); return { id: 77 }; },
    mintToken: async (installationId, repository, jwt, capability) => { calls.mint.push({ installationId, repository, jwt, capability }); return { token: 'source-installation-token', permissions: { contents: 'read' }, expiresAt: '2099-01-01T00:00:00Z' }; },
    fetch: async (url, init) => { calls.api.push({ url: String(url), authorization: init?.headers?.authorization }); return apiResponse; },
  });
  return { evidence, calls };
}

test('source freshness resolves independent source installation authority with read-only repository-name restriction', async () => {
  const artifactAuthorization = { owner: 'zailghe3', repository: 'fpo-artifacts', repositoryId: 42, installationId: 12 };
  const { evidence, calls } = harness();
  await evidence.json('/git/ref/heads/main', new AbortController().signal);
  assert.deepEqual(calls.installation, [{ repository: { owner: 'zailghe3', repo: 'artifact-dev-toolkit' }, jwt: 'server-jwt' }]);
  assert.deepEqual(calls.mint, [{ installationId: 77, repository: 'artifact-dev-toolkit', jwt: 'server-jwt', capability: 'read' }]);
  assert.equal(calls.api[0].authorization, 'Bearer source-installation-token');
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(`${artifactAuthorization.repository}|${artifactAuthorization.repositoryId}|${artifactAuthorization.installationId}`));
});

for (const [name, response, reason] of [
  ['429', new Response('private upstream body', { status: 429 }), 'github_rate_limited'],
  ['rate-limited 403', new Response('private upstream body', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }), 'github_rate_limited'],
  ['ordinary 403', new Response('private upstream body', { status: 403 }), 'github_access_unavailable'],
  ['404', new Response('private upstream body', { status: 404 }), 'github_access_unavailable'],
]) test(`GitHub ${name} maps to bounded ${reason}`, async () => {
  const { evidence } = harness(response);
  await assert.rejects(evidence.json('/compare/a...b', new AbortController().signal), error => error instanceof GitHubFreshnessEvidenceError && error.reason === reason && !error.message.includes('private'));
});

test('network failures and aborted requests retain bounded access and timeout reasons without secrets', async () => {
  clearGitHubFreshnessCredentialCacheForTests();
  const dependencies = {
    identity: () => ({ appId: 'app', privateKey: 'never-serialize-private-key' }), createJwt: async () => 'never-serialize-jwt',
    getInstallation: async () => ({ id: 77 }), mintToken: async () => ({ token: 'never-serialize-token', permissions: { contents: 'read' } }),
    fetch: async () => { throw new Error('raw socket failure with secret'); },
  };
  const evidence = createGitHubFreshnessEvidence(source, dependencies);
  const access = await evidence.json('/git/ref/heads/main', new AbortController().signal).catch(error => error);
  assert.equal(access.reason, 'github_access_unavailable');
  const controller = new AbortController(); controller.abort();
  const timeout = await evidence.json('/compare/a...b', controller.signal).catch(error => error);
  assert.equal(timeout.reason, 'comparison_timeout');
  assert.doesNotMatch(JSON.stringify({ access, timeout }), /secret|token|jwt|socket|authorization/i);
});

test('missing source installation is bounded access-unavailable evidence', async () => {
  clearGitHubFreshnessCredentialCacheForTests();
  const evidence = createGitHubFreshnessEvidence(source, {
    identity: () => ({ appId: 'app', privateKey: 'private' }), createJwt: async () => 'jwt',
    getInstallation: async () => { throw Object.assign(new Error('private GitHub installation response'), { status: 404 }); },
    fetch: async () => { throw new Error('must not fetch source contents'); },
  });
  await assert.rejects(evidence.json('/git/ref/heads/main', new AbortController().signal), error => error instanceof GitHubFreshnessEvidenceError && error.reason === 'github_access_unavailable' && !error.message.includes('private'));
});

test('bounded comparison failure reasons survive the live resolver', async () => {
  const deployed = '1'.repeat(40), head = '2'.repeat(40), signal = new AbortController().signal;
  for (const reason of ['github_rate_limited', 'github_access_unavailable', 'comparison_timeout']) {
    const result = await resolveComponentFromGitHubEvidence('runtime', deployed, signal, async () => head, async () => { throw new GitHubFreshnessEvidenceError(reason); }, async () => undefined);
    assert.deepEqual(result, { state: 'unknown', deployedRevision: deployed, sourceHeadRevision: head, unknownReason: reason });
    assert.doesNotMatch(JSON.stringify(result), /authorization|token|jwt|raw|exception/i);
  }
});

test('authenticated live evidence resolves the historical stale Runtime end to end and outranks Runner uncertainty', async () => {
  clearGitHubFreshnessCredentialCacheForTests();
  const deployed = '593841394bbdabfa17586df984b70b3fb03b94e1', head = 'bdaf073a053350942790f7d66209f6ec4eb01999';
  const evidence = createGitHubFreshnessEvidence(source, {
    identity: () => ({ appId: 'app', privateKey: 'private' }), createJwt: async () => 'jwt', getInstallation: async () => ({ id: 77 }),
    mintToken: async () => ({ token: 'source-token', permissions: { contents: 'read' }, expiresAt: '2099-01-01T00:00:00Z' }),
    fetch: async url => String(url).includes('/git/ref/') ? Response.json({ object: { sha: head } })
      : String(url).includes('/compare/') ? Response.json({ status: 'ahead', head_commit: { sha: head }, files: [{ filename: 'adt-runtime/src/adrian-commissioning.ts' }], commits: [{ sha: head }] })
      : String(url).endsWith(`/commits/${head}`) ? Response.json({ files: [{ filename: 'adt-runtime/src/adrian-commissioning.ts' }] })
      : new Response(null, { status: 404 }),
  });
  const signal = new AbortController().signal;
  const runtime = await resolveComponentFromGitHubEvidence('runtime', deployed, signal,
    currentSignal => evidence.json('/git/ref/heads/main', currentSignal).then(value => value.object.sha),
    (revision, sourceHead, currentSignal) => evidence.json(`/compare/${revision}...${sourceHead}`, currentSignal),
    (sha, currentSignal) => evidence.json(`/commits/${sha}`, currentSignal));
  assert.deepEqual(runtime, { state: 'superseded', deployedRevision: deployed, sourceHeadRevision: head, latestRelevantRevision: head });
  const components = { worker: { state: 'current', deployedRevision: head, sourceHeadRevision: head, latestRelevantRevision: head }, runtime, runner: { state: 'unknown', unknownReason: 'github_access_unavailable' } };
  const snapshot = { state: aggregateInfrastructureFreshness(components), checkedAt: new Date().toISOString(), components };
  assert.equal(snapshot.state, 'superseded');
  assert.equal(infrastructureFreshnessLabel(snapshot), 'Runtime update available');
  assert.equal(infrastructureRevisionLabel(snapshot), 'Runtime 5938413 → bdaf073');
});
