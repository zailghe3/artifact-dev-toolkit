import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ArtifactProposalCollisionError, ArtifactProposalIncompleteError, ArtifactWriteConflictError,
  ArtifactWriteValidationError, GitHubArtifactRepository, deletionProposalBranchName, proposalBranchName,
} from '../lib/artifact-repository.ts';
import { serializeArtifactMarkdown } from '../lib/artifact-contract.ts';

const path = 'artifacts/prompts/production.md';
const sourceSha = 'abcdef0123456789';
const sourceMarkdown = `---\nid: production\ntitle: Original title\ntype: prompt\nstatus: production\ntags: []\naliases: []\n---\nOriginal body\n`;
const updateMetadata = { id: 'production', title: 'Updated title', type: 'prompt', status: 'production', tags: [], aliases: [] };
const updateMarkdown = serializeArtifactMarkdown(updateMetadata, 'Updated body');
const updateSha = createHash('sha1').update(`blob ${Buffer.byteLength(updateMarkdown)}\0${updateMarkdown}`).digest('hex');
const leaf = (entryPath, sha, type = 'blob', mode = type === 'commit' ? '160000' : '100644') => ({ path: entryPath, mode, type, sha });
const baseLeaves = [leaf(path, sourceSha), leaf('README.md', 'readme-sha'), leaf('vendor/tool', 'gitlink-sha', 'commit')];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function runtime({ operation = 'update', existing = false, proposalLeaves, commit = {}, pulls, pullFailure, baseLeaves: configuredBase = baseLeaves, credentialProvider, baseTreeResponse, recoveryBaseTreeResponse, proposalTreeResponse } = {}) {
  const calls = [];
  const branch = operation === 'update' ? proposalBranchName('production', sourceSha) : deletionProposalBranchName('production', sourceSha);
  const targetLeaves = proposalLeaves ?? (operation === 'update'
    ? configuredBase.map((entry) => entry.path === path ? leaf(path, updateSha) : entry)
    : configuredBase.filter((entry) => entry.path !== path));
  let baseTreeReads = 0;
  const fetch = async (url, options = {}) => {
    const parsed = new URL(String(url)); const endpoint = parsed.pathname.replace('/repos/owner/repo', '');
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ endpoint, method: options.method ?? 'GET', body });
    if (options.method === 'POST') {
      if (endpoint === '/git/blobs') return json({ sha: updateSha });
      if (endpoint === '/git/trees') return json({ sha: 'generated-tree' });
      if (endpoint === '/git/commits') return json({ sha: 'proposal-commit' });
      if (endpoint === '/git/refs') return json({ ref: body.ref, object: { sha: body.sha } });
      if (endpoint === '/pulls') return pullFailure ? json({}, pullFailure) : json({ number: 17, html_url: 'https://github.com/owner/repo/pull/17' });
    }
    if (endpoint === '/git/ref/heads/main') return json({ object: { sha: 'base-commit' } });
    if (endpoint === `/git/ref/heads/${branch}`) return existing ? json({ object: { sha: 'proposal-commit' } }) : json({}, 404);
    if (endpoint === '/git/commits/base-commit') return json({ tree: { sha: 'base-tree' } });
    if (endpoint === '/git/commits/proposal-commit') return json({ tree: { sha: 'proposal-tree' }, parents: [{ sha: 'base-commit' }], ...commit });
    if (endpoint === '/git/trees/base-tree') { baseTreeReads += 1; return json(baseTreeReads > 1 && recoveryBaseTreeResponse ? recoveryBaseTreeResponse : baseTreeResponse ?? { tree: configuredBase, truncated: false }); }
    if (endpoint === '/git/trees/proposal-tree') return json(proposalTreeResponse ?? { tree: targetLeaves, truncated: false });
    if (endpoint === '/pulls') return json(pulls ?? [{ number: 17, html_url: 'https://github.com/owner/repo/pull/17', head: { ref: branch }, base: { ref: 'main' } }]);
    if (endpoint === `/git/blobs/${sourceSha}`) return json({ encoding: 'base64', size: Buffer.byteLength(sourceMarkdown), content: Buffer.from(sourceMarkdown).toString('base64') });
    return json({}, 404);
  };
  const repository = new GitHubArtifactRepository({ owner: 'owner', repo: 'repo', branch: 'main', rootPath: 'artifacts', fetch, sleep: async () => {}, logger: { info() {}, error() {} }, credentialProvider: credentialProvider ?? (async () => ({ token: 'token', permissions: { contents: 'write', pullRequests: 'write' } })) });
  return { repository, calls, branch };
}
const updateInput = { id: 'production', metadata: updateMetadata, body: 'Updated body', currentFileSha: sourceSha, actorLogin: 'octocat' };
const deleteInput = { id: 'production', currentFileSha: sourceSha, actorLogin: 'octocat' };

for (const operation of ['update', 'delete']) test(`successful production ${operation} proposal uses exact Git Data mutation and safe metadata`, async () => {
  const r = runtime({ operation });
  const result = operation === 'update' ? await r.repository.proposeUpdate(updateInput) : await r.repository.proposeDelete(deleteInput);
  const tree = r.calls.find((call) => call.endpoint === '/git/trees' && call.method === 'POST').body;
  assert.equal(tree.base_tree, 'base-tree');
  assert.deepEqual(tree.tree, [{ path, mode: '100644', type: 'blob', sha: operation === 'update' ? updateSha : null }]);
  const commit = r.calls.find((call) => call.endpoint === '/git/commits' && call.method === 'POST').body;
  assert.deepEqual(commit.parents, ['base-commit']); assert.match(commit.message, /@octocat/); assert.doesNotMatch(commit.message, /Original body|Updated body/);
  const ref = r.calls.find((call) => call.endpoint === '/git/refs').body;
  assert.deepEqual(ref, { ref: `refs/heads/${r.branch}`, sha: 'proposal-commit' });
  const pull = r.calls.find((call) => call.endpoint === '/pulls' && call.method === 'POST').body;
  assert.deepEqual({ head: pull.head, base: pull.base }, { head: r.branch, base: 'main' }); assert.match(pull.title, operation === 'update' ? /^Update artifact:/ : /^Delete artifact:/); assert.doesNotMatch(pull.body, /Original body|Updated body/);
  assert.deepEqual(Object.keys(result).sort(), ['artifactId','branchName','commitSha','path','pullRequestNumber','pullRequestUrl']);
  assert.equal(r.calls.some((call) => call.method === 'DELETE' || call.method === 'PATCH' || call.method === 'PUT'), false);
});

for (const operation of ['update', 'delete']) test(`identical existing ${operation} proposal and matching pull request are idempotent`, async () => {
  const r = runtime({ operation, existing: true });
  const result = operation === 'update' ? await r.repository.proposeUpdate(updateInput) : await r.repository.proposeDelete(deleteInput);
  assert.equal(result.branchName, r.branch); assert.equal(result.pullRequestNumber, 17);
  assert.equal(r.calls.some((call) => call.method === 'POST'), false);
  assert.equal(r.calls.some((call) => call.endpoint === '/git/trees/proposal-tree'), true);
});

const collisionCases = [
  ['wrong parent', { commit: { parents: [{ sha: 'other' }] } }],
  ['multiple parents', { commit: { parents: [{ sha: 'base-commit' }, { sha: 'other' }] } }],
  ['unrelated addition', { proposalLeaves: [...baseLeaves.map((e) => e.path === path ? leaf(path, updateSha) : e), leaf('extra', 'extra')] }],
  ['unrelated change', { proposalLeaves: baseLeaves.map((e) => e.path === path ? leaf(path, updateSha) : e.path === 'README.md' ? leaf('README.md', 'changed') : e) }],
  ['unrelated deletion', { proposalLeaves: baseLeaves.filter((e) => e.path !== 'README.md').map((e) => e.path === path ? leaf(path, updateSha) : e) }],
  ['gitlink change', { proposalLeaves: baseLeaves.map((e) => e.path === path ? leaf(path, updateSha) : e.type === 'commit' ? leaf(e.path, 'changed', 'commit') : e) }],
  ['missing pull', { pulls: [] }],
  ['unsafe pull URL', { pulls: [{ number: 1, html_url: 'https://evil.example/pull/1', head: { ref: proposalBranchName('production', sourceSha) }, base: { ref: 'main' } }] }],
];
for (const [name, options] of collisionCases) test(`update recovery rejects ${name}`, async () => {
  await assert.rejects(runtime({ operation: 'update', existing: true, ...options }).repository.proposeUpdate(updateInput), ArtifactProposalCollisionError);
});
for (const [name, target] of [['executable target', leaf(path, updateSha, 'blob', '100755')], ['non-blob target', leaf(path, updateSha, 'commit', '160000')], ['wrong blob', leaf(path, 'wrong-sha')]]) test(`update recovery rejects ${name}`, async () => {
  const leaves = baseLeaves.map((e) => e.path === path ? target : e);
  await assert.rejects(runtime({ operation: 'update', existing: true, proposalLeaves: leaves }).repository.proposeUpdate(updateInput), ArtifactProposalCollisionError);
});
for (const [name, leaves] of [
  ['target still present', baseLeaves],
  ['unrelated blob changed', baseLeaves.filter((e) => e.path !== path).map((e) => e.path === 'README.md' ? leaf(e.path, 'changed') : e)],
  ['gitlink changed', baseLeaves.filter((e) => e.path !== path).map((e) => e.type === 'commit' ? leaf(e.path, 'changed', 'commit') : e)],
]) test(`deletion recovery rejects ${name}`, async () => {
  await assert.rejects(runtime({ operation: 'delete', existing: true, proposalLeaves: leaves }).repository.proposeDelete(deleteInput), ArtifactProposalCollisionError);
});

test('stale source revision and invalid actor fail before any mutation', async () => {
  const stale = runtime({ operation: 'delete' }); await assert.rejects(stale.repository.proposeDelete({ ...deleteInput, currentFileSha: '1111111122222222' }), ArtifactWriteConflictError); assert.equal(stale.calls.some((c) => c.method === 'POST'), false);
  const invalid = runtime({ operation: 'delete' }); await assert.rejects(invalid.repository.proposeDelete({ ...deleteInput, actorLogin: 'bad login' }), ArtifactWriteValidationError); assert.equal(invalid.calls.length, 0);
});

test('branch-created PR failures produce bounded incomplete recovery without retrying mutation', async () => {
  for (const status of [403, 503, 409, 422]) {
    const r = runtime({ operation: 'delete', pullFailure: status, pulls: [] });
    const error = await r.repository.proposeDelete(deleteInput).then(() => undefined, (value) => value);
    assert.ok(error instanceof ArtifactProposalIncompleteError); assert.equal(error.branchName, r.branch); assert.equal(error.branchUrl, `https://github.com/owner/repo/tree/${r.branch.split('/').join('/')}`);
    assert.equal(r.calls.filter((call) => call.endpoint === '/pulls' && call.method === 'POST').length, 1);
    assert.equal(r.calls.filter((call) => call.endpoint === '/git/refs' && call.method === 'POST').length, 1);
  }
});

test('a concurrent matching pull request is recovered after PR conflict', async () => {
  const r = runtime({ operation: 'update', pullFailure: 422 });
  const result = await r.repository.proposeUpdate(updateInput);
  assert.equal(result.pullRequestNumber, 17); assert.equal(r.calls.filter((c) => c.endpoint === '/pulls' && c.method === 'POST').length, 1);
});

const deletionCollisionCases = [
  ['wrong parent', { commit: { parents: [{ sha: 'other' }] } }],
  ['multiple parents', { commit: { parents: [{ sha: 'base-commit' }, { sha: 'other' }] } }],
  ['unrelated added blob', { proposalLeaves: [...baseLeaves.filter((e) => e.path !== path), leaf('extra.md', 'extra')] }],
  ['unrelated deleted blob', { proposalLeaves: baseLeaves.filter((e) => e.path !== path && e.path !== 'README.md') }],
  ['unrelated changed blob', { proposalLeaves: baseLeaves.filter((e) => e.path !== path).map((e) => e.path === 'README.md' ? leaf(e.path, 'changed') : e) }],
  ['changed gitlink', { proposalLeaves: baseLeaves.filter((e) => e.path !== path).map((e) => e.type === 'commit' ? leaf(e.path, 'changed', 'commit') : e) }],
  ['target still present', { proposalLeaves: baseLeaves }],
  ['source SHA mismatch', { recoveryBaseTreeResponse: { tree: baseLeaves.map((e) => e.path === path ? leaf(path, 'different-source') : e), truncated: false } }],
  ['missing matching open PR', { pulls: [] }],
  ['wrong PR head', { pulls: [{ number: 17, html_url: 'https://github.com/owner/repo/pull/17', head: { ref: 'wrong' }, base: { ref: 'main' } }] }],
  ['wrong PR base', { pulls: [{ number: 17, html_url: 'https://github.com/owner/repo/pull/17', head: { ref: deletionProposalBranchName('production', sourceSha) }, base: { ref: 'other' } }] }],
  ['unsafe PR URL', { pulls: [{ number: 17, html_url: 'https://evil.example/pull/17', head: { ref: deletionProposalBranchName('production', sourceSha) }, base: { ref: 'main' } }] }],
  ['truncated base tree', { recoveryBaseTreeResponse: { tree: baseLeaves, truncated: true } }],
  ['truncated proposal tree', { proposalTreeResponse: { tree: baseLeaves.filter((e) => e.path !== path), truncated: true } }],
  ['malformed base tree', { recoveryBaseTreeResponse: { tree: null, truncated: false } }],
  ['malformed proposal tree', { proposalTreeResponse: { tree: null, truncated: false } }],
];
for (const [name, options] of deletionCollisionCases) test(`deletion recovery rejects ${name} without mutation`, async () => {
  const r = runtime({ operation: 'delete', existing: true, ...options });
  await assert.rejects(r.repository.proposeDelete(deleteInput), ArtifactProposalCollisionError);
  assert.equal(r.calls.some((call) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(call.method)), false);
});
