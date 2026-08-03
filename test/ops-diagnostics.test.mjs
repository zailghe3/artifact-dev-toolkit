import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubArtifactRepository, ArtifactRepositoryAccessError, ArtifactRepositoryContentError, ArtifactRepositoryUnavailableError } from '../lib/artifact-repository.ts';
import { mapOperationalError } from '../lib/operational-errors.ts';

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

test('operational failures map to stable safe categories while unknown errors stay unexpected', () => {
  assert.equal(mapOperationalError(new ArtifactRepositoryAccessError()).category, 'repository_read_permission_required');
  assert.equal(mapOperationalError(new ArtifactRepositoryUnavailableError(429)).category, 'github_rate_limited');
  assert.equal(mapOperationalError(new ArtifactRepositoryUnavailableError(503)).category, 'github_temporarily_unavailable');
  assert.equal(mapOperationalError(new ArtifactRepositoryContentError()).category, 'artifact_repository_invalid');
  assert.equal(mapOperationalError(new Error('private upstream detail')).category, 'unexpected_error');
  assert.doesNotMatch(JSON.stringify(mapOperationalError(new Error('private upstream detail'))), /private upstream detail/);
});
