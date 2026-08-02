import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ArtifactDuplicateError, ArtifactRepositoryUnavailableError, ArtifactSecretRejectedError,
  ArtifactWriteConflictError, ArtifactWritePermissionError, ArtifactWriteResponseError,
  ArtifactWriteValidationError, GitHubArtifactRepository,
} from '../lib/artifact-repository.ts';

const metadata = { id: 'new-prompt', title: 'New Prompt', type: 'prompt', status: 'draft', tags: ['writing'], aliases: [] };
const existingMarkdown = `---\nid: new-prompt\ntitle: New Prompt\ntype: prompt\nstatus: draft\ntags: [writing]\naliases: []\n---\n\nOld body\n`;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function fake({ files = {}, writeStatus = 200, writeValue } = {}) {
  const calls = [];
  const entries = Object.entries(files);
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/git/trees/main')) return json({ truncated: false, tree: entries.map(([path], index) => ({ path, type: 'blob', sha: `blob-${index}` })) });
    if (pathname.includes('/git/blobs/')) {
      const index = Number(pathname.split('blob-')[1]);
      const content = entries[index][1];
      return json({ encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') });
    }
    return json(writeValue ?? { content: { path: 'artifacts/prompts/new-prompt.md', sha: 'new-blob' }, commit: { sha: 'commit-1', html_url: 'https://github.example/commit/1' } }, writeStatus);
  };
  return { calls, repository: new GitHubArtifactRepository({ owner: 'owner', repo: 'repo', branch: 'main', rootPath: 'artifacts', credentialProvider: async () => 'installation-secret', fetch, sleep: async () => {}, logger: { info() {}, error() {} } }) };
}

test('create serializes canonical Markdown, sends one Contents API write, and returns commit metadata', async () => {
  const runtime = fake();
  const result = await runtime.repository.create({ metadata, body: '  Useful body  ', actorLogin: 'octocat' });
  const write = runtime.calls.find((call) => call.options.method === 'PUT');
  assert.ok(write.url.endsWith('/repos/owner/repo/contents/artifacts/prompts/new-prompt.md'));
  const payload = JSON.parse(write.options.body);
  assert.equal(payload.message, 'Create artifact new-prompt (requested by @octocat)');
  assert.equal(Buffer.from(payload.content, 'base64').toString(), '---\nid: new-prompt\ntitle: New Prompt\ntype: prompt\nstatus: draft\ntags:\n  - writing\naliases: []\n---\nUseful body\n');
  assert.deepEqual(result, { artifactId: 'new-prompt', path: 'artifacts/prompts/new-prompt.md', fileSha: 'new-blob', commitSha: 'commit-1', commitUrl: 'https://github.example/commit/1', repositoryRevision: 'commit-1' });
  assert.equal(JSON.stringify(result).includes('installation-secret'), false);
  assert.equal(payload.message.includes('installation-secret'), false);
});

test('create rejects an occupied target path without writing', async () => {
  const runtime = fake({ files: { 'artifacts/prompts/new-prompt.md': existingMarkdown } });
  await assert.rejects(runtime.repository.create({ metadata, body: 'Body', actorLogin: 'octocat' }), ArtifactDuplicateError);
  assert.equal(runtime.calls.some((call) => call.options.method === 'PUT'), false);
});

test('create rejects a duplicate ID at another path without writing', async () => {
  const runtime = fake({ files: { 'artifacts/templates/different.md': existingMarkdown.replace('type: prompt', 'type: template') } });
  await assert.rejects(runtime.repository.create({ metadata, body: 'Body', actorLogin: 'octocat' }), ArtifactDuplicateError);
  assert.equal(runtime.calls.some((call) => call.options.method === 'PUT'), false);
});

test('invalid and secret-like create input is rejected before GitHub is called', async () => {
  for (const [input, ErrorType] of [
    [{ ...metadata, id: '../unsafe' }, ArtifactWriteValidationError],
    [metadata, ArtifactSecretRejectedError],
  ]) {
    const runtime = fake();
    await assert.rejects(runtime.repository.create({ metadata: input, body: ErrorType === ArtifactSecretRejectedError ? 'token=abcdefghijklmnopqrstuvwxyz123456' : 'Body', actorLogin: 'octocat' }), ErrorType);
    assert.equal(runtime.calls.length, 0);
  }
});

test('update uses the supplied current SHA and succeeds', async () => {
  const runtime = fake({ files: { 'artifacts/prompts/new-prompt.md': existingMarkdown } });
  await runtime.repository.update({ id: metadata.id, metadata, body: 'Updated', currentFileSha: 'blob-0', actorLogin: 'octocat' });
  const payload = JSON.parse(runtime.calls.find((call) => call.options.method === 'PUT').options.body);
  assert.equal(payload.sha, 'blob-0');
  assert.equal(payload.message, 'Update artifact new-prompt (requested by @octocat)');
});

test('update rejects a stale SHA before sending a write', async () => {
  const runtime = fake({ files: { 'artifacts/prompts/new-prompt.md': existingMarkdown } });
  await assert.rejects(runtime.repository.update({ id: metadata.id, metadata, body: 'Updated', currentFileSha: 'old', actorLogin: 'octocat' }), ArtifactWriteConflictError);
  assert.equal(runtime.calls.some((call) => call.options.method === 'PUT'), false);
});

test('write failures preserve permission, conflict, and temporary classifications without retries', async () => {
  for (const [status, ErrorType] of [[403, ArtifactWritePermissionError], [409, ArtifactWriteConflictError], [429, ArtifactRepositoryUnavailableError], [503, ArtifactRepositoryUnavailableError]]) {
    const runtime = fake({ files: { 'artifacts/prompts/new-prompt.md': existingMarkdown }, writeStatus: status, writeValue: { private: 'upstream body' } });
    await assert.rejects(runtime.repository.update({ id: metadata.id, metadata, body: 'Updated', currentFileSha: 'blob-0', actorLogin: 'octocat' }), ErrorType);
    assert.equal(runtime.calls.filter((call) => call.options.method === 'PUT').length, 1);
  }
});

test('malformed successful write responses fail closed', async () => {
  const runtime = fake({ writeValue: { content: {}, commit: {} } });
  await assert.rejects(runtime.repository.create({ metadata, body: 'Body', actorLogin: 'octocat' }), ArtifactWriteResponseError);
});
