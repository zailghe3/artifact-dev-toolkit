import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubArtifactRepository, ArtifactRepositoryAccessError, ArtifactRepositoryContentError, ArtifactRepositoryUnavailableError, ArtifactBranchNotFoundError, ArtifactRepositoryNotFoundError } from '../lib/artifact-repository.ts';
import { mapOperationalError } from '../lib/operational-errors.ts';
import { classifyCapabilityResult } from '../lib/diagnostics-model.ts';
import { getPublicRepositoryConfiguration, storedRepositoryMatchesPublicConfiguration } from '../lib/public-repository-configuration.ts';
import { CatalogueCacheUnavailableError, CatalogueSnapshotCorruptError } from '../lib/artifact-catalogue.ts';

const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const valid = `---\nid: valid-one\ntitle: Valid one\ntype: prompt\nstatus: draft\ntags: []\naliases: []\n---\n\nSafe body`;
const duplicate = valid.replaceAll('valid-one', 'duplicate-one').replaceAll('Valid one', 'Duplicate');

test('diagnostics scan collects invalid files and duplicate IDs without returning bodies', async () => {
  const blobs = new Map([['a'.repeat(40), valid], ['b'.repeat(40), 'not front matter'], ['c'.repeat(40), duplicate], ['d'.repeat(40), duplicate]]);
  const fetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.includes('/git/trees/')) return response({ truncated: false, tree: [...blobs.keys()].map((sha, i) => ({ path: `artifacts/prompts/${i}.md`, type: 'blob', sha })) });
    const raw = blobs.get(pathname.split('/').at(-1)); return response({ encoding: 'base64', size: Buffer.byteLength(raw), content: Buffer.from(raw).toString('base64') });
  };
  const repository = new GitHubArtifactRepository({ owner: 'owner', repo: 'repo', branch: 'main', rootPath: 'artifacts', fetch, credentialProvider: async () => ({ token: 'test-token-never-returned', permissions: { contents: 'read' } }), logger: { info() {}, error() {} }, sleep: async () => {} });
  const report = await repository.diagnoseCatalogue('e'.repeat(40));
  assert.equal(report.validCount, 1); assert.equal(report.invalidCount, 3);
  assert.ok(report.errors.some(error => error.code === 'invalid_front_matter'));
  assert.equal(report.errors.filter(error => error.code === 'duplicate_id').length, 2);
  assert.doesNotMatch(JSON.stringify(report), /Safe body|test-token/);
});

test('diagnostics counts distinct unsafe entries without exposing their repository paths', async () => {
  const unsafe = ['artifacts/../secret-one.md', 'artifacts/prompts/../../secret-two.md', 'artifacts//secret-three.md'];
  const logs = [];
  const repository = new GitHubArtifactRepository({ owner: 'owner', repo: 'repo', rootPath: 'artifacts', fetch: async (url) => String(url).includes('/git/trees/') ? response({ tree: unsafe.map((path, index) => ({ path, type: 'blob', sha: String(index + 1).repeat(40) })) }) : response({}), credentialProvider: async () => ({ token: 'hidden', permissions: { contents: 'read' } }), logger: { info(value) { logs.push(value); }, error(value) { logs.push(value); } } });
  const report = await repository.diagnoseCatalogue('a'.repeat(40));
  assert.equal(report.invalidCount, 3);
  assert.deepEqual(report.errors.map(({ path }) => path), unsafe.map(() => '[unsafe repository path]'));
  assert.doesNotMatch(JSON.stringify({ report, logs }), /secret-one|secret-two|secret-three/);
});

test('diagnostics classifies isolated blob failures explicitly', async () => {
  for (const [blob, code] of [[new Response('', { status: 404 }), 'blob_unavailable'], [response({ encoding: 'utf-8', content: 'hidden' }), 'unsupported_encoding'], [response({ encoding: 'base64', size: 2_000_000, content: '' }), 'blob_too_large']]) {
    const repository = new GitHubArtifactRepository({ owner: 'owner', repo: 'repo', rootPath: 'artifacts', fetch: async (url) => String(url).includes('/git/trees/') ? response({ tree: [{ path: 'artifacts/prompts/a.md', type: 'blob', sha: 'a'.repeat(40) }] }) : blob, credentialProvider: async () => ({ token: 'hidden', permissions: { contents: 'read' } }), logger: { info() {}, error() {} } });
    assert.equal((await repository.diagnoseCatalogue('b'.repeat(40))).errors[0].code, code);
  }
});

test('operational failures map to stable safe categories while unknown errors stay unexpected', () => {
  assert.equal(mapOperationalError(new ArtifactRepositoryAccessError()).category, 'repository_read_permission_required');
  assert.equal(mapOperationalError(new ArtifactRepositoryUnavailableError(429)).category, 'github_rate_limited');
  assert.equal(mapOperationalError(new ArtifactRepositoryUnavailableError(503)).category, 'github_temporarily_unavailable');
  assert.equal(mapOperationalError(new ArtifactRepositoryContentError()).category, 'artifact_repository_invalid');
  assert.equal(mapOperationalError(new Error('private upstream detail')).category, 'unexpected_error');
  assert.doesNotMatch(JSON.stringify(mapOperationalError(new Error('private upstream detail'))), /private upstream detail/);
});

test('public repository identity remains enforceable when unrelated secrets are malformed', () => {
  const before = { ...process.env };
  Object.assign(process.env, { ARTIFACT_REPOSITORY: 'github', NODE_ENV: 'test', GITHUB_ARTIFACT_REPOSITORY_OWNER: 'Owner', GITHUB_ARTIFACT_REPOSITORY_NAME: 'Repo', GITHUB_APP_PRIVATE_KEY: 'not-a-key', SESSION_SECRET: 'short' });
  try {
    const config = getPublicRepositoryConfiguration();
    assert.equal(config.identityValid, true);
    assert.equal(storedRepositoryMatchesPublicConfiguration({ owner: 'owner', repo: 'repo' }, config), true);
    assert.equal(storedRepositoryMatchesPublicConfiguration({ owner: 'owner', repo: 'other' }, config), false);
  } finally { process.env = before; }
});

test('capability outcomes retain effective permission and safe reason', () => {
  const required = [['contents', ['read', 'write', 'admin']]];
  assert.deepEqual(classifyCapabilityResult({ status: 'fulfilled', value: { permissions: { contents: 'read' } } }, required), { effective: true, reason: 'granted' });
  assert.deepEqual(classifyCapabilityResult({ status: 'fulfilled', value: { permissions: { contents: 'none' } } }, required), { effective: false, reason: 'permission_missing' });
  assert.equal(classifyCapabilityResult({ status: 'rejected', reason: { status: 403 } }, required).reason, 'installation_missing');
  assert.equal(classifyCapabilityResult({ status: 'rejected', reason: { status: 429 } }, required).reason, 'rate_limited');
  assert.equal(classifyCapabilityResult({ status: 'rejected', reason: { status: 503 } }, required).reason, 'temporarily_unavailable');
  assert.equal(classifyCapabilityResult({ status: 'fulfilled', value: {} }, required).reason, 'malformed_response');
});

for (const status of [403, 429, 503]) test(`repository-wide ${status} remains a systemic diagnostics failure`, async () => {
  let calls = 0;
  const repository = new GitHubArtifactRepository({ owner: 'owner', repo: 'repo', fetch: async () => { calls++; return response({}, status); }, credentialProvider: async () => ({ token: 'never-visible', permissions: { contents: 'read' } }), sleep: async () => {}, logger: { info() {}, error() {} } });
  await assert.rejects(repository.diagnoseCatalogue('a'.repeat(40)), status === 403 ? ArtifactRepositoryAccessError : ArtifactRepositoryUnavailableError);
  assert.ok(calls >= 1);
});

test('all declared read operational categories are reachable without leaking source errors', () => {
  assert.equal(mapOperationalError(new ArtifactBranchNotFoundError()).category, 'branch_not_found');
  assert.equal(mapOperationalError(new ArtifactRepositoryNotFoundError()).category, 'repository_not_found');
  assert.equal(mapOperationalError(new CatalogueCacheUnavailableError()).category, 'catalogue_cache_unavailable');
  assert.equal(mapOperationalError(new CatalogueSnapshotCorruptError()).category, 'catalogue_cache_corrupt');
});
