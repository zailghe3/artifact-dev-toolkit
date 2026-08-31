import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installTsxHook } from './render-tsx.mjs';
import { canTestProviderConnection, providerConnectionOutputLimit, providerConnectionTestFeedback } from '../lib/provider-connection-presentation.ts';

const requireTsx = installTsxHook();
const { CodexRunnerConnection } = requireTsx('../components/CodexRunnerConnection.tsx');
const { OperationFeedback, isCurrentProviderTestSequence, providerTestFeedbackAfterCredentialOperation } = requireTsx('../components/ProviderConnectionEditor.tsx');

test('OpenAI connection testing is enabled only for configured idle connections', () => {
  assert.equal(canTestProviderConnection({ busy: false, configured: true }), true);
  assert.equal(canTestProviderConnection({ busy: true, configured: true }), false);
  assert.equal(canTestProviderConnection({ busy: false, configured: false }), false);
});

test('OpenAI connection test feedback is bounded, fail-safe, and ignores provider-supplied secret fields', () => {
  const longOutput = 'x'.repeat(providerConnectionOutputLimit + 50);
  const success = providerConnectionTestFeedback({ ok: true, output: longOutput, message: 'secret-message', credential_iv: 'secret-iv' });
  assert.match(success, /^Connection successful/);
  assert.equal(success.includes('x'.repeat(providerConnectionOutputLimit)), true);
  assert.equal(success.includes('x'.repeat(providerConnectionOutputLimit + 1)), false);
  assert.doesNotMatch(success, /secret-message|secret-iv/);
  assert.equal(providerConnectionTestFeedback({ ok: false, category: 'authentication_failed', message: 'upstream secret' }), 'Authentication failed.');
  assert.equal(providerConnectionTestFeedback({ ok: true, output: 'should not be trusted' }, false), 'Connection test could not be completed.');
  assert.equal(providerConnectionTestFeedback({ ok: false, category: 'unknown', stack: 'secret stack' }), 'Connection test could not be completed.');
});

test('connection editor operation feedback has distinct accessible presentation', () => {
  const credential = renderToStaticMarkup(React.createElement(OperationFeedback, { label: 'Credential operation result', message: 'Credential configured.' }));
  const provider = renderToStaticMarkup(React.createElement(OperationFeedback, { label: 'Provider connection test result', message: 'Connection successful.' }));
  const runtime = renderToStaticMarkup(React.createElement(OperationFeedback, { label: 'ADT Runtime diagnostic result', message: 'ADT Runtime: reachable yes.' }));
  assert.match(credential, /aria-label="Credential operation result"[^>]*>Credential configured\./);
  assert.match(provider, /aria-label="Provider connection test result"[^>]*>Connection successful\./);
  assert.match(runtime, /aria-label="ADT Runtime diagnostic result"[^>]*>ADT Runtime: reachable yes\./);
  assert.doesNotMatch(credential, /Provider connection test result|ADT Runtime diagnostic result/);
  assert.equal(providerTestFeedbackAfterCredentialOperation('Connection successful.', true), '');
  assert.equal(providerTestFeedbackAfterCredentialOperation('Connection successful.', false), 'Connection successful.');
});

test('provider test sequencing ignores completions invalidated by a credential change', () => {
  let currentSequence = 0;
  const originalTest = ++currentSequence;
  assert.equal(isCurrentProviderTestSequence(currentSequence, originalTest), true);
  currentSequence += 1;
  assert.equal(isCurrentProviderTestSequence(currentSequence, originalTest), false);
  const currentTest = ++currentSequence;
  assert.equal(isCurrentProviderTestSequence(currentSequence, currentTest), true);
  assert.equal(isCurrentProviderTestSequence(currentSequence, originalTest), false);
});

test('Codex Runner connection presents the advertised job-execution capability', () => {
  const capabilities = {
    protocolVersion: 1,
    runnerVersion: 'b'.repeat(40),
    codexAvailable: true,
    deviceAuth: true,
    jobExecution: true,
    releaseMetadata: 'legacy',
  };
  const supported = renderToStaticMarkup(React.createElement(CodexRunnerConnection, {
    initialStatus: { state: 'connected', label: 'Connected', capabilities, auth: { connected: true } },
  }));
  assert.match(supported, /<dt>Coding jobs<\/dt><dd>Supported<\/dd>/);

  const unsupported = renderToStaticMarkup(React.createElement(CodexRunnerConnection, {
    initialStatus: { state: 'connected', label: 'Connected', capabilities: { ...capabilities, jobExecution: false }, auth: { connected: true } },
  }));
  assert.match(unsupported, /<dt>Coding jobs<\/dt><dd>Not supported by this Runner<\/dd>/);
});
