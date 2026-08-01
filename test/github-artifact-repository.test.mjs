import test from 'node:test';
import assert from 'node:assert/strict';

import { ArtifactRepositoryAccessError, ArtifactRepositoryContentError, ArtifactRepositoryUnavailableError, GitHubArtifactRepository, getArtifactRepositoryBackend } from '../lib/artifact-repository.ts';

function markdown(frontMatter, body = 'Body') {
  return `---\n${frontMatter.trim()}\n---\n\n${body}\n`;
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function base64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function createFetch(fixtures) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/git/trees/main')) {
      return jsonResponse({
        truncated: false,
        tree: Object.keys(fixtures).map((file, index) => ({ path: file, type: 'blob', sha: `sha-${index + 1}` })),
      });
    }
    const sha = parsed.pathname.split('/').at(-1);
    const index = Number(sha?.replace('sha-', '')) - 1;
    const file = Object.keys(fixtures)[index];
    return jsonResponse({ encoding: 'base64', size: Buffer.byteLength(fixtures[file]), content: base64(fixtures[file]) });
  };
  fetch.calls = calls;
  return fetch;
}

function repository(fetch, overrides = {}) {
  return new GitHubArtifactRepository({
    owner: 'example-owner',
    repo: 'artifact-store',
    credentialProvider: async () => 'installation-token',
    branch: 'main',
    rootPath: 'artifacts',
    fetch,
    ...overrides,
  });
}

function quietRuntime() {
  const entries = [];
  return {
    entries,
    sleep: async (milliseconds) => entries.push({ sleep: milliseconds }),
    logger: {
      info: (value) => entries.push(JSON.parse(value)),
      error: (value) => entries.push(JSON.parse(value)),
    },
  };
}

test('GitHubArtifactRepository lists nested Markdown artifacts as sorted Artifact models', async () => {
  const fetch = createFetch({
    'README.md': '# ignored',
    'artifacts/prompts/b.md': markdown(`
id: beta
title: Beta Prompt
type: prompt
status: draft
tags: [beta]
aliases: []
`, 'Beta body with   whitespace.'),
    'artifacts/variations/nested/a.md': markdown(`
id: alpha
title: Alpha Variation
type: snippet
status: production
tags: []
aliases: [first]
`, 'Alpha body.'),
    'artifacts/prompts/not-markdown.txt': 'ignored',
  });

  const artifacts = await repository(fetch).list();

  assert.deepEqual(artifacts.map((artifact) => artifact.id), ['alpha', 'beta']);
  assert.equal(artifacts[0].path, 'artifacts/variations/nested/a.md');
  assert.equal(artifacts[0].excerpt, 'Alpha body.');
  assert.equal(artifacts[1].body, 'Beta body with   whitespace.');
  assert.equal(fetch.calls[0].options.headers.authorization, 'Bearer installation-token');
});

test('GitHubArtifactRepository findById returns one parsed artifact', async () => {
  const fetch = createFetch({
    'artifacts/prompts/a.md': markdown(`
id: wanted
title: Wanted
type: prompt
status: production
tags: []
aliases: []
`),
  });

  const artifact = await repository(fetch).findById('wanted');

  assert.equal(artifact?.title, 'Wanted');
});

test('GitHubArtifactRepository preserves a genuine empty repository as an empty list', async () => {
  const fetch = createFetch({ 'README.md': '# ignored' });

  const artifacts = await repository(fetch).list();

  assert.deepEqual(artifacts, []);
});

test('GitHubArtifactRepository rejects duplicate IDs with file-specific diagnostics', async () => {
  const fetch = createFetch({
    'artifacts/prompts/a.md': markdown(`
id: duplicate
title: A
type: prompt
status: production
tags: []
aliases: []
`),
    'artifacts/snippets/b.md': markdown(`
id: duplicate
title: B
type: snippet
status: production
tags: []
aliases: []
`),
  });

  await assert.rejects(repository(fetch).list(), /Duplicate artifact id "duplicate" found in artifacts\/snippets\/b\.md; already used by artifacts\/prompts\/a\.md/);
});

test('GitHubArtifactRepository reports malformed artifacts with the source file path', async () => {
  const fetch = createFetch({
    'artifacts/prompts/bad.md': markdown(`
id: bad
type: prompt
status: production
tags: []
aliases: []
`),
  });

  await assert.rejects(repository(fetch).list(), /artifacts\/prompts\/bad\.md: title:/);
});

test('GitHubArtifactRepository surfaces GitHub API failures instead of returning zero artifacts', async () => {
  const fetch = async () => new Response('nope', { status: 503, statusText: 'Service Unavailable' });

  await assert.rejects(repository(fetch).list(), /temporarily unavailable/);
});

test('repository API responses preserve access, content, and availability categories', async () => {
  const runtime = quietRuntime();
  for (const status of [401, 403]) {
    await assert.rejects(repository(async () => new Response('private response', { status }), runtime).list(), ArtifactRepositoryAccessError);
  }
  await assert.rejects(repository(async () => new Response('private response', { status: 404 }), runtime).list(), ArtifactRepositoryContentError);
  for (const status of [429, 500, 502, 503]) {
    await assert.rejects(repository(async () => new Response('private response', { status }), runtime).list(), ArtifactRepositoryUnavailableError);
  }
});

test('blob loading is bounded to four requests and remains complete and sorted', async () => {
  const fixtures = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
    `artifacts/prompts/${String(index).padStart(2, '0')}.md`,
    markdown(`id: item-${index}\ntitle: ${String(12 - index).padStart(2, '0')} title\ntype: prompt\nstatus: draft\ntags: []\naliases: []`),
  ]));
  const baseFetch = createFetch(fixtures);
  let active = 0;
  let maximumActive = 0;
  const fetch = async (...args) => {
    if (!String(args[0]).includes('/git/blobs/')) return baseFetch(...args);
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    try { return await baseFetch(...args); } finally { active--; }
  };
  const artifacts = await repository(fetch, quietRuntime()).list();
  assert.equal(artifacts.length, 12);
  assert.equal(maximumActive, 4);
  assert.deepEqual(artifacts.map(({ title }) => title), [...artifacts.map(({ title }) => title)].sort());
});

test('a temporary blob HTTP failure retries only that blob with secret-free diagnostics', async () => {
  const secretToken = 'github_pat_DISTINCTIVE_TOKEN_THAT_MUST_NEVER_APPEAR_12345678901234567890123456789012345678901234567890123456789';
  const responseSecret = 'response-body-secret-DISTINCTIVE';
  const runtime = quietRuntime();
  const baseFetch = createFetch({
    'artifacts/prompts/a.md': markdown('id: a\ntitle: A\ntype: prompt\nstatus: draft\ntags: []\naliases: []'),
    'artifacts/prompts/b.md': markdown('id: b\ntitle: B\ntype: prompt\nstatus: draft\ntags: []\naliases: []'),
  });
  let failedBlobAttempts = 0;
  const fetch = async (url, options) => {
    if (String(url).endsWith('/git/blobs/sha-1') && ++failedBlobAttempts === 1) return new Response(responseSecret, { status: 503 });
    return baseFetch(url, options);
  };
  const artifacts = await repository(fetch, { ...runtime, credentialProvider: async () => secretToken }).list();
  assert.deepEqual(artifacts.map(({ id }) => id), ['a', 'b']);
  assert.equal(failedBlobAttempts, 2);
  const retry = runtime.entries.find(({ event }) => event === 'github_artifact_request_retry');
  assert.deepEqual(retry, { event: 'github_artifact_request_retry', operation: 'blob', path: 'artifacts/prompts/a.md', status: 503, attempt: 2, maxAttempts: 3 });
  const logs = JSON.stringify(runtime.entries);
  assert.equal(logs.includes(secretToken), false);
  assert.equal(logs.includes(responseSecret), false);
});

test('a temporary blob network failure recovers', async () => {
  const runtime = quietRuntime();
  const baseFetch = createFetch({ 'artifacts/prompts/a.md': markdown('id: a\ntitle: A\ntype: prompt\nstatus: draft\ntags: []\naliases: []') });
  let attempts = 0;
  const fetch = async (url, options) => {
    if (String(url).includes('/git/blobs/') && ++attempts === 1) throw new TypeError('network failed with private URL data');
    return baseFetch(url, options);
  };
  assert.equal((await repository(fetch, runtime).list()).length, 1);
  assert.equal(attempts, 2);
});

test('blob retry exhaustion returns no partial list and logs safe final classification', async () => {
  const runtime = quietRuntime();
  const baseFetch = createFetch({ 'artifacts/prompts/a.md': markdown('id: a\ntitle: A\ntype: prompt\nstatus: draft\ntags: []\naliases: []') });
  let attempts = 0;
  const fetch = async (url, options) => {
    if (String(url).includes('/git/blobs/')) { attempts++; return new Response('sensitive body', { status: 503 }); }
    return baseFetch(url, options);
  };
  await assert.rejects(repository(fetch, runtime).list(), ArtifactRepositoryUnavailableError);
  assert.equal(attempts, 3);
  assert.deepEqual(runtime.entries.find(({ event }) => event === 'github_artifact_request_failed'), {
    event: 'github_artifact_request_failed', operation: 'blob', path: 'artifacts/prompts/a.md', category: 'temporary_unavailable', status: 503, attempts: 3,
  });
  assert.equal(JSON.stringify(runtime.entries).includes('sensitive body'), false);
});

test('Retry-After rate limiting uses injected sleep and then recovers', async () => {
  const runtime = quietRuntime();
  const baseFetch = createFetch({ 'artifacts/prompts/a.md': markdown('id: a\ntitle: A\ntype: prompt\nstatus: draft\ntags: []\naliases: []') });
  let attempts = 0;
  const fetch = async (url, options) => {
    if (String(url).includes('/git/blobs/') && ++attempts === 1) return new Response('', { status: 429, headers: { 'retry-after': '2' } });
    return baseFetch(url, options);
  };
  assert.equal((await repository(fetch, runtime).list()).length, 1);
  assert.equal(runtime.entries.some(({ sleep }) => sleep === 2_000), true);
});

test('permanent blob failures and invalid content are not retried', async () => {
  for (const [status, ErrorType] of [[403, ArtifactRepositoryAccessError], [404, ArtifactRepositoryContentError]]) {
    const baseFetch = createFetch({ 'artifacts/prompts/a.md': markdown('id: a\ntitle: A\ntype: prompt\nstatus: draft\ntags: []\naliases: []') });
    let attempts = 0;
    const fetch = async (url, options) => String(url).includes('/git/blobs/') ? (attempts++, new Response('', { status })) : baseFetch(url, options);
    await assert.rejects(repository(fetch, quietRuntime()).list(), ErrorType);
    assert.equal(attempts, 1);
  }
  for (const invalidBlob of [
    { encoding: 'base64', content: base64(markdown('id: missing-title\ntype: prompt\nstatus: draft\ntags: []\naliases: []')) },
    { encoding: 'utf-8', content: 'not supported' },
  ]) {
    let attempts = 0;
    const fetch = async (url) => String(url).includes('/git/trees/')
      ? jsonResponse({ truncated: false, tree: [{ path: 'artifacts/prompts/a.md', type: 'blob', sha: 'one' }] })
      : (attempts++, jsonResponse(invalidBlob));
    await assert.rejects(repository(fetch, quietRuntime()).list());
    assert.equal(attempts, 1);
  }
});

test('repeated library loading remains complete and stable', async () => {
  const fetch = createFetch({
    'artifacts/prompts/b.md': markdown('id: b\ntitle: B\ntype: prompt\nstatus: draft\ntags: []\naliases: []'),
    'artifacts/prompts/a.md': markdown('id: a\ntitle: A\ntype: prompt\nstatus: draft\ntags: []\naliases: []'),
  });
  const repo = repository(fetch, quietRuntime());
  assert.deepEqual(await repo.list(), await repo.list());
});

test('backend selection is explicit and fails closed in production', () => {
  assert.equal(getArtifactRepositoryBackend({ NODE_ENV: 'test' }), 'file');
  assert.equal(getArtifactRepositoryBackend({ NODE_ENV: 'development', ARTIFACT_REPOSITORY: 'file' }), 'file');
  assert.equal(getArtifactRepositoryBackend({ NODE_ENV: 'production', ARTIFACT_REPOSITORY: 'github' }), 'github');
  assert.throws(() => getArtifactRepositoryBackend({ NODE_ENV: 'production', ARTIFACT_REPOSITORY: 'file' }), /not supported in production/);
  assert.throws(() => getArtifactRepositoryBackend({ NODE_ENV: 'production' }), /required in production/);
  assert.throws(() => getArtifactRepositoryBackend({ NODE_ENV: 'test', ARTIFACT_REPOSITORY: 'other' }), /Unsupported/);
});

test('installation credential failures preserve access and availability categories', async () => {
  for (const status of [429, 500, 503]) {
    await assert.rejects(repository(async () => { throw new Error('fetch must not run'); }, { credentialProvider: async () => { throw Object.assign(new Error('secret response'), { status }); } }).list(), /temporarily unavailable/);
  }
  for (const status of [401, 403, 404]) {
    await assert.rejects(repository(async () => { throw new Error('fetch must not run'); }, { credentialProvider: async () => { throw Object.assign(new Error('secret response'), { status }); } }).list(), /access is denied/);
  }
});

test('one installation credential is reused for the tree and every blob', async () => {
  let credentials = 0;
  const fetch = createFetch({
    'artifacts/prompts/a.md': markdown('id: a\ntitle: A\ntype: prompt\nstatus: draft\ntags: []\naliases: []'),
    'artifacts/agents/b.md': markdown('id: b\ntitle: B\ntype: agent\nstatus: draft\ntags: []\naliases: []'),
  });
  let tokenPromise;
  const repo = repository(fetch, { credentialProvider: () => tokenPromise ??= Promise.resolve(`token-${++credentials}`) });
  await repo.list();
  assert.equal(credentials, 1);
  assert.equal(fetch.calls.every(call => call.options.headers.authorization === 'Bearer token-1'), true);
});
