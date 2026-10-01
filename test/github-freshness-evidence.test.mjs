import test from 'node:test';
import assert from 'node:assert/strict';
import { clearGitHubFreshnessCredentialCacheForTests, createGitHubFreshnessEvidence, GitHubFreshnessEvidenceError, GITHUB_COMMIT_FILE_PAGE_LIMIT } from '../lib/github-freshness-evidence.ts';
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

test('sequential source evidence reuses one completed installation credential', async () => {
  clearGitHubFreshnessCredentialCacheForTests();
  let installations = 0, mints = 0;
  const authorizations = [];
  const evidence = createGitHubFreshnessEvidence(source, {
    identity: () => ({ appId: 'app', privateKey: 'private' }), createJwt: async () => 'jwt',
    getInstallation: async () => { installations++; return { id: 77 }; },
    mintToken: async () => { mints++; return { token: 'one-source-token', permissions: { contents: 'read' }, expiresAt: '2099-01-01T00:00:00Z' }; },
    fetch: async (url, init) => { authorizations.push(init.headers.authorization); return String(url).includes('/commits/') ? page([{ filename: 'docs/complete.md' }]) : Response.json({ ok: true }); },
  });
  await evidence.json('/git/ref/heads/main', new AbortController().signal);
  await evidence.json('/compare/a...b', new AbortController().signal);
  await evidence.commitImpact('runtime', 'a'.repeat(40), new AbortController().signal);
  assert.deepEqual({ installations, mints }, { installations: 1, mints: 1 });
  assert.deepEqual(new Set(authorizations), new Set(['Bearer one-source-token']));
});

test('three commit pages reuse one installation resolution and token mint', async () => {
  clearGitHubFreshnessCredentialCacheForTests();
  let installations = 0, mints = 0, pages = 0;
  const evidence = createGitHubFreshnessEvidence(source, {
    identity: () => ({ appId: 'app', privateKey: 'private' }), createJwt: async () => 'jwt',
    getInstallation: async () => { installations++; return { id: 77 }; },
    mintToken: async () => { mints++; return { token: 'paged-source-token', permissions: { contents: 'read' }, expiresAt: '2099-01-01T00:00:00Z' }; },
    fetch: async (_url, init) => { pages++; assert.equal(init.headers.authorization, 'Bearer paged-source-token'); return page(docs(100), true); },
  });
  assert.equal(await evidence.commitImpact('runtime', 'b'.repeat(40), new AbortController().signal), 'incomplete');
  assert.deepEqual({ pages, installations, mints }, { pages: 3, installations: 1, mints: 1 });
});

test('concurrent cold source requests coalesce installation resolution and token mint', async () => {
  clearGitHubFreshnessCredentialCacheForTests();
  let installations = 0, mints = 0, release;
  const blocked = new Promise(resolve => { release = resolve; });
  const evidence = createGitHubFreshnessEvidence(source, {
    identity: () => ({ appId: 'app', privateKey: 'private' }), createJwt: async () => 'jwt',
    getInstallation: async () => { installations++; await blocked; return { id: 77 }; },
    mintToken: async () => { mints++; return { token: 'coalesced-token', permissions: { contents: 'read' }, expiresAt: '2099-01-01T00:00:00Z' }; },
    fetch: async () => Response.json({ ok: true }),
  });
  const requests = ['/one', '/two', '/three'].map(path => evidence.json(path, new AbortController().signal));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(installations, 1);
  release();
  await Promise.all(requests);
  assert.deepEqual({ installations, mints }, { installations: 1, mints: 1 });
});

test('expired source credential causes exactly one new installation resolution and mint', async () => {
  clearGitHubFreshnessCredentialCacheForTests();
  let now = 1_000, installations = 0, mints = 0;
  const evidence = createGitHubFreshnessEvidence(source, {
    now: () => now, identity: () => ({ appId: 'app', privateKey: 'private' }), createJwt: async () => 'jwt',
    getInstallation: async () => { installations++; return { id: 77 }; },
    mintToken: async () => { mints++; return { token: `token-${mints}`, permissions: { contents: 'read' } }; },
    fetch: async () => Response.json({ ok: true }),
  });
  await evidence.json('/one', new AbortController().signal);
  now += 60_001;
  await evidence.json('/two', new AbortController().signal);
  assert.deepEqual({ installations, mints }, { installations: 2, mints: 2 });
});

test('cached-token 401 invalidates, refreshes, and retries only once without leaking credentials', async () => {
  clearGitHubFreshnessCredentialCacheForTests();
  let installations = 0, mints = 0, apiCalls = 0;
  const evidence = createGitHubFreshnessEvidence(source, {
    identity: () => ({ appId: 'app', privateKey: 'private-value' }), createJwt: async () => 'jwt-value',
    getInstallation: async () => { installations++; return { id: 77 }; },
    mintToken: async () => { mints++; return { token: `source-token-${mints}`, permissions: { contents: 'read' }, expiresAt: '2099-01-01T00:00:00Z' }; },
    fetch: async (_url, init) => { apiCalls++; return init.headers.authorization === 'Bearer source-token-1' ? new Response(null, { status: 401 }) : Response.json({ ok: true }); },
  });
  assert.deepEqual(await evidence.json('/ref', new AbortController().signal), { ok: true });
  assert.deepEqual({ apiCalls, installations, mints }, { apiCalls: 2, installations: 2, mints: 2 });

  clearGitHubFreshnessCredentialCacheForTests(); installations = 0; mints = 0; apiCalls = 0;
  const rejected = createGitHubFreshnessEvidence(source, {
    identity: () => ({ appId: 'app', privateKey: 'private-value' }), createJwt: async () => 'jwt-value',
    getInstallation: async () => { installations++; return { id: 77 }; },
    mintToken: async () => { mints++; return { token: `rejected-token-${mints}`, permissions: { contents: 'read' } }; },
    fetch: async () => { apiCalls++; return new Response('raw private response', { status: 401 }); },
  });
  const failure = await rejected.json('/ref', new AbortController().signal).catch(error => error);
  assert.equal(failure.reason, 'github_access_unavailable');
  assert.deepEqual({ apiCalls, installations, mints }, { apiCalls: 2, installations: 2, mints: 2 });
  assert.doesNotMatch(JSON.stringify(failure), /token|jwt|private|authorization|raw/i);
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
      : String(url).includes(`/commits/${head}?`) ? Response.json({ files: [{ filename: 'adt-runtime/src/adrian-commissioning.ts' }] })
      : new Response(null, { status: 404 }),
  });
  const signal = new AbortController().signal;
  const runtime = await resolveComponentFromGitHubEvidence('runtime', deployed, signal,
    currentSignal => evidence.json('/git/ref/heads/main', currentSignal).then(value => value.object.sha),
    (revision, sourceHead, currentSignal) => evidence.json(`/compare/${revision}...${sourceHead}`, currentSignal),
    (component, sha, currentSignal) => evidence.commitImpact(component, sha, currentSignal));
  assert.deepEqual(runtime, { state: 'superseded', deployedRevision: deployed, sourceHeadRevision: head, latestRelevantRevision: head });
  const components = { worker: { state: 'current', deployedRevision: head, sourceHeadRevision: head, latestRelevantRevision: head }, runtime, runner: { state: 'unknown', unknownReason: 'github_access_unavailable' } };
  const snapshot = { state: aggregateInfrastructureFreshness(components), checkedAt: new Date().toISOString(), components };
  assert.equal(snapshot.state, 'superseded');
  assert.equal(infrastructureFreshnessLabel(snapshot), 'Runtime update available');
  assert.equal(infrastructureRevisionLabel(snapshot), 'Runtime 5938413 → bdaf073');
});

function paginatedEvidence(fetch, requests) {
  clearGitHubFreshnessCredentialCacheForTests();
  return createGitHubFreshnessEvidence(source, {
    identity: () => ({ appId: 'app', privateKey: 'private' }), createJwt: async () => 'jwt', getInstallation: async () => ({ id: 77 }),
    mintToken: async () => ({ token: 'source-token', permissions: { contents: 'read' }, expiresAt: '2099-01-01T00:00:00Z' }),
    fetch: async url => { requests.push(String(url)); return fetch(String(url)); },
  });
}

const page = (files, next = false) => Response.json({ files }, { headers: next ? { link: '<https://api.github.com/next>; rel="next"' } : {} });
const docs = count => Array.from({ length: count }, (_, index) => ({ filename: `docs/change-${index}.md` }));

test('a Runtime path on page two establishes the newest commit rather than an older target', async () => {
  const deployed = '1'.repeat(40), older = '2'.repeat(40), newest = '3'.repeat(40), requests = [];
  const evidence = paginatedEvidence(url => url.includes(`/commits/${newest}`) && url.includes('&page=1') ? page(docs(100), true)
    : url.includes(`/commits/${newest}`) ? page([{ filename: 'adt-runtime/src/server.ts' }])
    : page([{ filename: 'adt-runtime/src/older-change.ts' }]), requests);
  const result = await resolveComponentFromGitHubEvidence('runtime', deployed, new AbortController().signal, async () => newest,
    async () => ({ status: 'ahead', head_commit: { sha: newest }, files: [{ filename: 'adt-runtime/src/server.ts' }], commits: [{ sha: older }, { sha: newest }] }),
    (component, sha, signal) => evidence.commitImpact(component, sha, signal));
  assert.equal(result.latestRelevantRevision, newest);
  assert.equal(requests.filter(url => url.includes(`/commits/${newest}`)).length, 2);
  assert.equal(requests.some(url => url.includes(`/commits/${older}`)), false);
});

test('bounded partial commit evidence preserves superseded without guessing an older target or footer arrow', async () => {
  const deployed = '4'.repeat(40), older = '5'.repeat(40), newest = '6'.repeat(40), requests = [];
  const evidence = paginatedEvidence(() => page(docs(100), true), requests);
  const result = await resolveComponentFromGitHubEvidence('runtime', deployed, new AbortController().signal, async () => newest,
    async () => ({ status: 'ahead', head_commit: { sha: newest }, files: [{ filename: 'adt-runtime/src/proven-stale.ts' }], commits: [{ sha: older }, { sha: newest }] }),
    (component, sha, signal) => evidence.commitImpact(component, sha, signal));
  assert.equal(result.state, 'superseded');
  assert.equal('latestRelevantRevision' in result, false);
  assert.equal(requests.length, GITHUB_COMMIT_FILE_PAGE_LIMIT);
  assert.equal(requests.some(url => url.includes(`/commits/${older}`)), false);
  const snapshot = { state: 'superseded', checkedAt: new Date().toISOString(), components: { worker: { state: 'current' }, runtime: result, runner: { state: 'current' } } };
  assert.equal(infrastructureRevisionLabel(snapshot), 'Runtime 4444444');
});

test('a page-one positive match is cheap for Runtime and Worker', async () => {
  for (const [component, filename] of [['runtime', 'adt-runtime/src/server.ts'], ['worker', 'components/AppHeader.tsx']]) {
    const requests = [], sha = component === 'runtime' ? '7'.repeat(40) : '8'.repeat(40);
    const evidence = paginatedEvidence(() => page([{ filename }], true), requests);
    assert.equal(await evidence.commitImpact(component, sha, new AbortController().signal), 'relevant');
    assert.equal(requests.length, 1);
  }
});

test('only exhaustively irrelevant newest evidence permits inspecting the previous commit', async () => {
  const deployed = '9'.repeat(40), older = 'a'.repeat(40), newest = 'b'.repeat(40), requests = [];
  const evidence = paginatedEvidence(url => url.includes(`/commits/${newest}`) && url.includes('&page=1') ? page(docs(100), true)
    : url.includes(`/commits/${newest}`) ? page([{ filename: 'components/AppHeader.tsx' }])
    : page([{ filename: 'docs/renamed-runtime.ts', previous_filename: 'adt-runtime/src/older-change.ts' }]), requests);
  const result = await resolveComponentFromGitHubEvidence('runtime', deployed, new AbortController().signal, async () => newest,
    async () => ({ status: 'ahead', head_commit: { sha: newest }, files: [{ filename: 'adt-runtime/src/older-change.ts' }], commits: [{ sha: older }, { sha: newest }] }),
    (component, sha, signal) => evidence.commitImpact(component, sha, signal));
  assert.equal(result.latestRelevantRevision, older);
  assert.equal(requests.filter(url => url.includes(`/commits/${newest}`)).length, 2);
  assert.equal(requests.filter(url => url.includes(`/commits/${older}`)).length, 1);
});
