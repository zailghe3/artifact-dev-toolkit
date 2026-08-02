import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ArtifactDuplicateError, ArtifactRepositoryContentError, ArtifactRepositoryUnavailableError, ArtifactSecretRejectedError,
  ArtifactWriteConflictError, ArtifactWritePermissionError, ArtifactWriteResponseError,
  ArtifactWriteValidationError, GitHubArtifactRepository,
  ArtifactWriteTooLargeError,
} from '../lib/artifact-repository.ts';
import { MAX_SERIALIZED_ARTIFACT_BYTES, serializeArtifactMarkdown } from '../lib/artifact-contract.ts';

const metadata = { id: 'new-prompt', title: 'New Prompt', type: 'prompt', status: 'draft', tags: ['writing'], aliases: [] };
const existingMarkdown = `---\nid: new-prompt\ntitle: New Prompt\ntype: prompt\nstatus: draft\ntags: [writing]\naliases: []\n---\n\nOld body\n`;
const source = { ...metadata, id: 'source-prompt', title: 'Source Prompt', status: 'production', aliases: ['starter'], body: 'Source body', excerpt: 'Source body', path: 'artifacts/prompts/source-prompt.md' };
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
    const requestedPath = decodeURIComponent(pathname.split('/contents/')[1]);
    return json(writeValue ?? { content: { path: requestedPath, sha: 'new-blob' }, commit: { sha: 'commit-1', html_url: 'https://github.example/commit/1' } }, writeStatus);
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

test('createVariation persists canonical draft Markdown under variations with source metadata and attribution', async () => {
  const runtime = fake();
  const id = await runtime.repository.createVariation({ source, title: 'Focused Draft', body: '  Revised body  ', actorLogin: 'octocat' });
  assert.match(id, /^focused-draft-\d{4}-\d{2}-\d{2}-\d{6}$/);
  const write = runtime.calls.find((call) => call.options.method === 'PUT');
  assert.ok(write.url.endsWith(`/repos/owner/repo/contents/artifacts/variations/${id}.md`));
  const payload = JSON.parse(write.options.body);
  assert.equal(payload.message, `Create artifact ${id} (requested by @octocat)`);
  assert.equal(payload.branch, 'main');
  const markdown = Buffer.from(payload.content, 'base64').toString();
  assert.match(markdown, new RegExp(`id: ${id}`));
  assert.match(markdown, /title: Focused Draft\ntype: prompt\nstatus: draft/);
  assert.match(markdown, /tags:\n  - writing\n  - variation\naliases:\n  - starter\nsourceId: source-prompt\ncreatedAt:/);
  assert.ok(markdown.endsWith('Revised body\n'));
});

test('createVariation uses typed write safeguards before issuing a Contents API write', async () => {
  const duplicateRuntime = fake({ files: { 'artifacts/prompts/existing.md': existingMarkdown.replaceAll('new-prompt', 'focused-draft-2026-08-02-120000') } });
  const originalDate = Date;
  globalThis.Date = class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-08-02T12:00:00.000Z'])); } };
  try {
    await assert.rejects(duplicateRuntime.repository.createVariation({ source, title: 'Focused Draft', body: 'Body', actorLogin: 'octocat' }), ArtifactDuplicateError);
  } finally { globalThis.Date = originalDate; }
  assert.equal(duplicateRuntime.calls.some((call) => call.options.method === 'PUT'), false);

  const invalidRuntime = fake();
  await assert.rejects(invalidRuntime.repository.createVariation({ source, title: '!!!', body: 'Body', actorLogin: 'octocat' }), ArtifactWriteValidationError);
  assert.equal(invalidRuntime.calls.length, 0);

  const secretRuntime = fake();
  await assert.rejects(secretRuntime.repository.createVariation({ source, body: 'token=abcdefghijklmnopqrstuvwxyz123456', actorLogin: 'octocat' }), ArtifactSecretRejectedError);
  assert.equal(secretRuntime.calls.length, 0);
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

function bodyAtMost(limit, character = 'a') {
  const overhead = Buffer.byteLength(serializeArtifactMarkdown(metadata, 'x')) - Buffer.byteLength('x');
  return character.repeat(Math.floor((limit - overhead) / Buffer.byteLength(character)));
}

test('create and update enforce the shared serialized UTF-8 byte limit before writing', async () => {
  const allowed = bodyAtMost(MAX_SERIALIZED_ARTIFACT_BYTES);
  const createRuntime = fake();
  await createRuntime.repository.create({ metadata, body: allowed, actorLogin: 'octocat' });
  assert.equal(createRuntime.calls.filter((call) => call.options.method === 'PUT').length, 1);

  for (const operation of ['create', 'update']) {
    const runtime = fake({ files: operation === 'update' ? { 'artifacts/prompts/new-prompt.md': existingMarkdown } : {} });
    const input = { metadata, body: `${allowed}é`, actorLogin: 'octocat', ...(operation === 'update' ? { id: metadata.id, currentFileSha: 'blob-0' } : {}) };
    await assert.rejects(runtime.repository[operation](input), ArtifactWriteTooLargeError);
    assert.equal(runtime.calls.some((call) => call.options.method === 'PUT'), false);
  }
});

test('multibyte content is limited by UTF-8 bytes rather than JavaScript length', async () => {
  const runtime = fake();
  const body = bodyAtMost(MAX_SERIALIZED_ARTIFACT_BYTES, 'é') + 'é';
  assert.ok(body.length < MAX_SERIALIZED_ARTIFACT_BYTES);
  await assert.rejects(runtime.repository.create({ metadata, body, actorLogin: 'octocat' }), ArtifactWriteTooLargeError);
  assert.equal(runtime.calls.length, 0);
});

test('update preserves a valid nested path and does not move it when metadata changes', async () => {
  const nested = 'artifacts/prompts/client-a/custom.md';
  const runtime = fake({ files: { [nested]: existingMarkdown } });
  await runtime.repository.update({ id: metadata.id, metadata: { ...metadata, type: 'template', title: 'Changed' }, body: 'Updated', currentFileSha: 'blob-0', actorLogin: 'octocat' });
  const write = runtime.calls.find((call) => call.options.method === 'PUT');
  assert.ok(write.url.endsWith('/contents/artifacts/prompts/client-a/custom.md'));
  assert.equal(write.url.includes('/templates/new-prompt.md'), false);
  assert.equal(JSON.parse(write.options.body).sha, 'blob-0');
});

test('update rejects an artifact ID change before writing', async () => {
  const runtime = fake({ files: { 'artifacts/prompts/client-a/custom.md': existingMarkdown } });
  await assert.rejects(runtime.repository.update({ id: metadata.id, metadata: { ...metadata, id: 'renamed' }, body: 'Updated', currentFileSha: 'blob-0', actorLogin: 'octocat' }), ArtifactWriteValidationError);
  assert.equal(runtime.calls.some((call) => call.options.method === 'PUT'), false);
});

test('nested update still rejects stale revisions and invalid existing paths before writing', async () => {
  const nested = fake({ files: { 'artifacts/prompts/client-a/custom.md': existingMarkdown } });
  await assert.rejects(nested.repository.update({ id: metadata.id, metadata, body: 'Updated', currentFileSha: 'stale', actorLogin: 'octocat' }), ArtifactWriteConflictError);
  assert.equal(nested.calls.some((call) => call.options.method === 'PUT'), false);

  const invalid = fake({ files: { 'artifacts/prompts/../custom.md': existingMarkdown } });
  await assert.rejects(invalid.repository.update({ id: metadata.id, metadata, body: 'Updated', currentFileSha: 'blob-0', actorLogin: 'octocat' }), ArtifactRepositoryContentError);
  assert.equal(invalid.calls.some((call) => call.options.method === 'PUT'), false);
});
