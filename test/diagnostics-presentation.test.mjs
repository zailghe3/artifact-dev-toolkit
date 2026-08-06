import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installTsxHook } from './render-tsx.mjs';
import { cacheStatusPresentation, configurationStatusPresentation, diagnosticContributors, installationStatusPresentation, overallStatusPresentation, permissionStatusPresentation, validationStatusPresentation } from '../lib/diagnostics-presentation.ts';
import { deriveOverallDiagnosticsState } from '../lib/diagnostics-overall.ts';

const requireTsx = installTsxHook();
const { DiagnosticStatusBadge } = requireTsx('../components/DiagnosticStatusBadge.tsx');
const { LocalizedTime, formatLocalizedTime } = requireTsx('../components/LocalizedTime.tsx');

test('context-aware diagnostic presentation uses semantic tones and stable descriptions', () => {
  assert.deepEqual(configurationStatusPresentation('missing'), { label: 'Missing', tone: 'negative' });
  assert.deepEqual(cacheStatusPresentation('missing'), { label: 'Missing', tone: 'warning' });
  assert.deepEqual(installationStatusPresentation('missing'), { label: 'Missing', tone: 'negative' });
  assert.deepEqual(installationStatusPresentation('unknown'), { label: 'Unknown', tone: 'warning' });
  assert.equal(validationStatusPresentation('valid').tone, 'positive');
  for (const state of ['healthy', 'degraded', 'misconfigured', 'unauthorized', 'invalid_content', 'unavailable']) {
    assert.ok(overallStatusPresentation(state).description); assert.match(overallStatusPresentation(state).label, /\S/);
  }
  assert.equal(overallStatusPresentation('degraded').tone, 'warning');
  assert.equal(permissionStatusPresentation({ effective: false, reason: 'capability_request_rejected' }).label, 'Denied');
  assert.match(permissionStatusPresentation({ effective: false, reason: 'capability_request_rejected' }).description, /Contents write and Pull requests write/);
});

test('contributors are operationally ordered, deduplicated, bounded, and safe', () => {
  const diagnostics = { overall: 'degraded', configuration: { backend: 'invalid', authSecrets: { PRIVATE: 'missing' } }, authorization: { repositoryMatches: false, liveState: 'denied' }, permissions: { contentsRead: { effective: false }, contentsWrite: { effective: false }, pullRequestsWrite: { effective: 'unknown' } }, repositoryRevision: { state: 'unavailable' }, cache: { state: 'stale' }, validation: { state: 'unavailable' } };
  const result = diagnosticContributors(diagnostics, 3);
  assert.equal(result.contributors.length, 3); assert.ok(result.omittedCount > 0);
  assert.equal(result.contributors.filter(item => item.id === 'repository-configuration').length, 1);
  assert.equal(result.contributors[0].id, 'repository-configuration');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|token|exception|payload/i);
  assert.deepEqual(diagnosticContributors({ ...diagnostics, overall: 'healthy' }), { contributors: [], omittedCount: 0 });
});

const configuredSecrets = Object.fromEntries(['GITHUB_APP_ID', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_TOKEN_ENCRYPTION_KEY', 'SESSION_SECRET'].map(name => [name, 'configured']));
const healthyDiagnostics = () => ({
  overall: 'healthy',
  configuration: { backend: 'github', owner: 'owner', repository: 'repo', authSecrets: { ...configuredSecrets } },
  authorization: { repositoryMatches: true, liveState: 'authorized' },
  permissions: { contentsRead: { effective: true }, contentsWrite: { effective: true }, pullRequestsWrite: { effective: true } },
  repositoryRevision: { state: 'available' }, cache: { state: 'fresh' }, validation: { state: 'valid' },
});
const withCondition = (change) => {
  const value = healthyDiagnostics();
  change(value);
  value.overall = deriveOverallDiagnosticsState(value);
  return value;
};

test('each isolated degraded or failing condition has an accurate anchored contributor', () => {
  const cases = [
    ['unknown Contents read', d => { d.permissions.contentsRead.effective = 'unknown'; }, 'Contents read permission could not be verified.', '#permissions'],
    ['unknown Contents write', d => { d.permissions.contentsWrite.effective = 'unknown'; }, 'Contents write permission could not be verified.', '#permissions-write'],
    ['denied Contents read', d => { d.permissions.contentsRead.effective = false; }, 'Contents read permission is not granted.', '#permissions'],
    ['denied Contents write', d => { d.permissions.contentsWrite.effective = false; }, 'Contents write permission is not granted.', '#permissions-write'],
    ['unknown proposal', d => { d.permissions.pullRequestsWrite.effective = 'unknown'; }, 'Production proposal permission could not be verified.', '#permissions-proposal'],
    ['denied proposal', d => { d.permissions.pullRequestsWrite.effective = false; }, 'The production proposal credential was denied.', '#permissions-proposal'],
    ['live authorization unavailable', d => { d.authorization.liveState = 'temporarily_unavailable'; }, 'Live repository authorization is temporarily unavailable.', '#authorization'],
    ...[
      ['stale', 'Catalogue data is stale.'],
      ['missing', 'The catalogue snapshot is missing.'],
      ['degraded', 'Catalogue content is fresh, but cache persistence is temporarily unavailable.'],
      ['corrupt', 'The catalogue snapshot is invalid or corrupt.'],
      ['unavailable', 'Catalogue data is currently unavailable.'],
    ].map(([state, message]) => [`${state} cache`, d => { d.cache.state = state; }, message, '#catalogue-cache']),
    ['unavailable validation', d => { d.validation.state = 'unavailable'; }, 'Repository validation is temporarily unavailable.', '#artifact-validation'],
    ['invalid validation', d => { d.validation.state = 'invalid'; }, 'One or more artifacts are invalid.', '#artifact-validation'],
    ['missing session secret', d => { d.configuration.authSecrets.SESSION_SECRET = 'missing'; }, 'The session configuration is missing or invalid.', '#repository-configuration'],
    ['missing GitHub App setting', d => { d.configuration.authSecrets.GITHUB_APP_ID = 'missing'; }, 'A required GitHub App setting is missing or invalid.', '#repository-configuration'],
  ];
  for (const [name, mutate, message, href] of cases) {
    const result = diagnosticContributors(withCondition(mutate), 20).contributors;
    assert.ok(result.some(item => item.message === message && item.href === href), name);
  }
});

test('overall state and contributors stay aligned across every severity', () => {
  const cases = [
    ['degraded', d => { d.cache.state = 'stale'; }],
    ['misconfigured', d => { d.configuration.authSecrets.SESSION_SECRET = 'missing'; }],
    ['unauthorized', d => { d.permissions.contentsRead.effective = false; }],
    ['invalid_content', d => { d.validation.state = 'invalid'; }],
    ['unavailable', d => { d.repositoryRevision.state = 'unavailable'; }],
  ];
  for (const [expected, mutate] of cases) {
    const diagnostics = withCondition(mutate);
    assert.equal(diagnostics.overall, expected);
    assert.ok(diagnosticContributors(diagnostics).contributors.length > 0, expected);
  }
  assert.deepEqual(diagnosticContributors(healthyDiagnostics()), { contributors: [], omittedCount: 0 });
});

test('contributor wording distinguishes degraded cache and configuration categories without leaking inputs', () => {
  const degraded = diagnosticContributors(withCondition(d => { d.cache.state = 'degraded'; }), 20);
  const degradedMessage = degraded.contributors.find(item => item.id === 'catalogue-cache').message;
  assert.doesNotMatch(degradedMessage, /corrupt/);
  assert.doesNotMatch(degradedMessage, /data is .*unavailable/i);
  const session = diagnosticContributors(withCondition(d => { d.configuration.authSecrets.SESSION_SECRET = 'missing'; }), 20);
  assert.doesNotMatch(JSON.stringify(session), /GitHub App|SESSION_SECRET|secret-value|token|payload|raw response|exception/i);
});

test('badge renders every tone with border, marker, visible label, and accessible status text', () => {
  for (const tone of ['positive', 'warning', 'negative', 'neutral']) {
    const html = renderToStaticMarkup(React.createElement(DiagnosticStatusBadge, { presentation: { label: `Visible ${tone}`, tone } }));
    assert.match(html, /border-/); assert.match(html, /●/); assert.match(html, new RegExp(`Visible ${tone}`)); assert.match(html, new RegExp(`${tone} status:`));
  }
});

test('localized time formatting is deterministic with explicit locale and timezone', () => {
  const winter = formatLocalizedTime('2026-01-15T12:30:00.000Z', 'en-GB', 'Europe/London');
  const summer = formatLocalizedTime('2026-07-15T12:30:00.000Z', 'en-GB', 'Europe/London');
  assert.match(winter, /GMT/); assert.match(summer, /BST/); assert.equal(formatLocalizedTime('invalid', 'en-GB', 'UTC'), null);
  const value = '2026-07-15T12:30:00.000Z'; const html = renderToStaticMarkup(React.createElement(LocalizedTime, { value, prefix: 'Generated ' }));
  assert.match(html, /dateTime="2026-07-15T12:30:00.000Z"/); assert.match(html, /title="2026-07-15T12:30:00.000Z"/); assert.match(html, /Generated 2026-07-15T12:30:00.000Z/);
});
