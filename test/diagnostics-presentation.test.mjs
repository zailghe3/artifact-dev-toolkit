import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installTsxHook } from './render-tsx.mjs';
import { cacheStatusPresentation, configurationStatusPresentation, diagnosticContributors, installationStatusPresentation, overallStatusPresentation, permissionStatusPresentation, validationStatusPresentation } from '../lib/diagnostics-presentation.ts';

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
