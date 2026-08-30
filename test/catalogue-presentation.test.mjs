import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogueStatusMessage, localArtifactDetail, stableRefreshTime } from '../lib/catalogue-presentation.ts';

const artifact = { id: 'one', title: 'One', type: 'prompt', status: 'production', tags: [], aliases: [], body: 'body', excerpt: 'body', path: 'prompts/one.md' };
test('stale and degraded detail messages are distinct and accurate', () => { assert.match(catalogueStatusMessage('stale'), /older than.*GitHub|older than the current repository/i); assert.match(catalogueStatusMessage('stale'), /conflict/i); assert.match(catalogueStatusMessage('degraded'), /fresh from GitHub/i); assert.doesNotMatch(catalogueStatusMessage('degraded'), /older/i); });
test('refresh timestamps render deterministically without browser locale', () => { assert.equal(stableRefreshTime('2026-08-02T12:34:56.000Z'), '2026-08-02 12:34:56 UTC'); });
test('file-backed detail metadata requires no cache or file SHA', () => { const detail = localArtifactDetail(artifact, '2026-08-02T00:00:00.000Z'); assert.equal(detail.artifact, artifact); assert.equal(detail.currentFileSha, ''); assert.equal(detail.catalogue.cacheEnabled, false); });
