import test from 'node:test';
import assert from 'node:assert/strict';

import { GitHubArtifactRepository } from '../lib/artifact-repository.ts';

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

  await assert.rejects(repository(fetch).list(), /GitHub artifact repository request failed with 503 Service Unavailable/);
});
