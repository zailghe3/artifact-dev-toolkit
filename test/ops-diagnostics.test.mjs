import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubArtifactRepository, ArtifactRepositoryAccessError, ArtifactRepositoryContentError, ArtifactRepositoryUnavailableError, ArtifactBranchNotFoundError, ArtifactRepositoryNotFoundError } from '../lib/artifact-repository.ts';
import { mapOperationalError } from '../lib/operational-errors.ts';
import { classifyCapabilityResult } from '../lib/diagnostics-model.ts';
import { getPublicRepositoryConfiguration, storedRepositoryMatchesPublicConfiguration } from '../lib/public-repository-configuration.ts';
import { CatalogueCacheUnavailableError, CatalogueSnapshotCorruptError } from '../lib/artifact-catalogue.ts';

const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const valid = `---\nid: valid-one\ntitle: Valid one\ntype: prompt\ntags: []\naliases: []\n---\n\nSafe body`;
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
  assert.deepEqual(classifyCapabilityResult({ status: 'rejected', reason: { status: 422 } }, required), { effective: false, reason: 'capability_request_rejected' });
  assert.equal(classifyCapabilityResult({ status: 'rejected', reason: new TypeError('network detail') }, required).reason, 'temporarily_unavailable');
  assert.equal(classifyCapabilityResult({ status: 'rejected', reason: { status: 418 } }, required).reason, 'request_failed');
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

import { catalogueRefreshAvailability } from '../lib/diagnostics-model.ts';

const baseDiagnostics = (overrides = {}) => ({
  configuration: { backend: 'github', owner: 'owner', repository: 'repo', branch: 'main', artifactRoot: 'artifacts', cacheBinding: 'configured', authSecrets: Object.fromEntries(['GITHUB_APP_ID', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_TOKEN_ENCRYPTION_KEY', 'SESSION_SECRET'].map(name => [name, 'configured'])) },
  authorization: { storedState: 'authorized', lastCheckedAt: '2026-01-01T00:00:00.000Z', repositoryMatches: true, repositoryIdPresent: true, installationIdPresent: true, liveState: 'authorized' },
  permissions: { contentsRead: { effective: true, reason: 'granted' }, contentsWrite: { effective: true, reason: 'granted' }, pullRequestsWrite: { effective: true, reason: 'granted' } },
  ...overrides,
});

test('catalogue refresh policy exposes controls only for usable GitHub infrastructure and authorization', () => {
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics()), { available: true });
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ configuration: { ...baseDiagnostics().configuration, backend: 'file' } })), { available: false, reason: 'local_backend' });
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ configuration: { ...baseDiagnostics().configuration, cacheBinding: 'missing' } })), { available: false, reason: 'cache_binding_missing' });
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ authorization: { ...baseDiagnostics().authorization, repositoryIdPresent: false } })), { available: false, reason: 'repository_identity_missing' });
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ authorization: { ...baseDiagnostics().authorization, installationIdPresent: false } })), { available: false, reason: 'installation_identity_missing' });
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ authorization: { ...baseDiagnostics().authorization, repositoryMatches: false } })), { available: false, reason: 'authorization_unavailable' });
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ authorization: { ...baseDiagnostics().authorization, liveState: 'denied' } })), { available: false, reason: 'authorization_unavailable' });
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ permissions: { ...baseDiagnostics().permissions, contentsRead: { effective: false, reason: 'permission_missing' } } })), { available: false, reason: 'read_permission_missing' });
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ configuration: { ...baseDiagnostics().configuration, owner: undefined } })), { available: false, reason: 'configuration_invalid' });
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ configuration: { ...baseDiagnostics().configuration, authSecrets: { ...baseDiagnostics().configuration.authSecrets, GITHUB_APP_PRIVATE_KEY: 'invalid' } } })), { available: false, reason: 'configuration_invalid' });
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ configuration: { ...baseDiagnostics().configuration, authSecrets: { ...baseDiagnostics().configuration.authSecrets, SESSION_SECRET: 'invalid' } } })), { available: true });
});

test('catalogue refresh policy distinguishes retryable permission checks from unusable unknown outcomes', () => {
  for (const reason of ['temporarily_unavailable', 'rate_limited']) {
    assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ permissions: { ...baseDiagnostics().permissions, contentsRead: { effective: 'unknown', reason } } })), { available: true });
  }
  assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ permissions: { ...baseDiagnostics().permissions, contentsRead: { effective: 'unknown', reason: 'authentication_failed' } } })), { available: false, reason: 'authentication_unavailable' });
  for (const reason of ['malformed_response', 'prerequisite_invalid', 'installation_missing', 'not_checked']) {
    assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ permissions: { ...baseDiagnostics().permissions, contentsRead: { effective: 'unknown', reason } } })), { available: false, reason: 'read_permission_unverified' });
  }
});

test('catalogue refresh policy allows repair for non-fresh cache states when infrastructure is configured', () => {
  for (const state of ['fresh', 'stale', 'degraded', 'missing', 'corrupt']) {
    assert.deepEqual(catalogueRefreshAvailability(baseDiagnostics({ cache: { state } })), { available: true });
  }
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installTsxHook } from './render-tsx.mjs';
const requireTsx = installTsxHook();
const { CatalogueHealthSummary } = requireTsx('../components/CatalogueHealthSummary.tsx');
const { CatalogueRefreshControls } = requireTsx('../components/CatalogueRefresh.tsx');

test('catalogue refresh controls explain every unavailable policy outcome safely', () => {
  const expected = {
    local_backend: 'Manual catalogue refresh is not used by the local file backend.',
    cache_binding_missing: 'Configure the catalogue cache binding before refreshing.',
    repository_identity_missing: 'Repository details are unavailable. Reauthorize repository access before refreshing.',
    installation_identity_missing: 'Repository installation details are unavailable. Reauthorize repository access before refreshing.',
    authorization_unavailable: 'Restore repository authorization before refreshing the catalogue.',
    authentication_unavailable: 'Repository read access could not be verified. Resolve the authentication problem before refreshing.',
    read_permission_missing: 'Restore repository read access before refreshing the catalogue.',
    read_permission_unverified: 'Repository read access could not be verified. Reauthorize repository access before refreshing.',
    configuration_invalid: 'Correct the GitHub App configuration before refreshing the catalogue.',
  };
  for (const [reason, message] of Object.entries(expected)) {
    const html = renderToStaticMarkup(React.createElement(CatalogueRefreshControls, { availability: { available: false, reason } }));
    assert.match(html, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(html, /token|secret|encrypted|exception/i);
  }
});

test('catalogue health summary uses semantic badges and localized time without substituting generation time', () => {
  const refreshedAt = '2026-02-03T04:05:06.000Z';
  for (const state of ['fresh', 'stale', 'degraded']) {
    const html = renderToStaticMarkup(React.createElement(CatalogueHealthSummary, { cache: { configured: true, state, refreshedAt } }));
    assert.match(html, new RegExp(`Catalogue state:.*${state[0].toUpperCase()}${state.slice(1)}`));
    assert.match(html, /positive status:|warning status:/);
    assert.match(html, /dateTime="2026-02-03T04:05:06.000Z"/);
    assert.match(html, /title="2026-02-03T04:05:06.000Z"/);
    assert.match(html, /Last successful refresh:.*2026-02-03T04:05:06.000Z/);
  }
  for (const state of ['missing', 'corrupt', 'unavailable']) {
    const html = renderToStaticMarkup(React.createElement(CatalogueHealthSummary, { cache: { configured: true, state }, generatedAt: '2026-09-09T00:00:00.000Z' }));
    assert.match(html, new RegExp(`Catalogue state:.*${state[0].toUpperCase()}${state.slice(1)}`));
    assert.match(html, /Last successful refresh: unknown/);
    assert.doesNotMatch(html, /refreshed|2026-09-09/);
  }
});
