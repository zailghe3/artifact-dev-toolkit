import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installTsxHook } from './render-tsx.mjs';
import { canTestProviderConnection, providerConnectionOutputLimit, providerConnectionTestFeedback } from '../lib/provider-connection-presentation.ts';

const requireTsx = installTsxHook();
const { ProviderConnectionForm } = requireTsx('../components/ProviderConnectionForm.tsx');
const { CodexRunnerConnection } = requireTsx('../components/CodexRunnerConnection.tsx');
const { ProviderConnectionMigration } = requireTsx('../components/ProviderConnectionMigration.tsx');
const { ADTRuntimeDiagnosticButton, adtRuntimeDiagnosticMessage } = requireTsx('../components/ADTRuntimeDiagnosticButton.tsx');

test('OpenAI connection testing is enabled only for configured idle connections', () => {
  assert.equal(canTestProviderConnection({ busy: false, configured: true }), true);
  assert.equal(canTestProviderConnection({ busy: true, configured: true }), false);
  assert.equal(canTestProviderConnection({ busy: false, configured: false }), false);

  const ready = renderToStaticMarkup(React.createElement(ProviderConnectionForm, { model: 'gpt-test', ready: true, storageAvailable: true }));
  const unavailable = renderToStaticMarkup(React.createElement(ProviderConnectionForm, { model: 'gpt-test', ready: false, storageAvailable: true }));
  assert.match(ready, />Test connection<\/button>/);
  assert.doesNotMatch(ready, /<button[^>]*disabled=""[^>]*>Test connection<\/button>/);
  assert.match(unavailable, /<button[^>]*disabled=""[^>]*>Test connection<\/button>/);
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

test('provider migration UI presents safe copy targets and retained historical compatibility without destructive controls',()=>{const html=renderToStaticMarkup(React.createElement(ProviderConnectionMigration,{initial:{connectionId:'openai-migrate',connectionName:'Migration source',configuredModel:'model-sentinel',targetPath:'connections/openai-migrate.connection.json',definition:{},canonicalJson:'{"safe":"definition"}\n',secretRef:'WORKFLOW_PROVIDER_CONNECTION_OPENAI_MIGRATE',secretProvisioning:'resolved',state:'git_ready_shadowing_d1',message:'Git is authoritative and live-ready.',repositoryRevision:'revision-sentinel'}}));assert.match(html,/Copy JSON|Copy binding name|Historical run compatibility retained|shadowed D1 row remains intact|cannot be exported|Cloudflare control plane/);assert.doesNotMatch(html,/Retire D1 fallback|plaintext-unit-secret|encrypted_credential|credential_iv/)});

test('openai-agents commissioning action and messages expose only independent bounded safe Runtime fields',()=>{const html=renderToStaticMarkup(React.createElement(ADTRuntimeDiagnosticButton,{onMessage:()=>{}})),message=adtRuntimeDiagnosticMessage({configured:true,reachable:true,authenticationAccepted:true,protocolCompatible:true,capabilityAvailable:true,wrappingKeyMatches:true,runtimeRevision:'safe-revision',httpStatus:200,elapsedMs:12});assert.match(html,/Test ADT Runtime/);for(const field of ['configured yes','reachable yes','authentication yes','protocol yes','openai-agents capability yes','wrapping key yes','revision safe-revision','HTTP 200','12 ms'])assert.ok(message.includes(field));assert.doesNotMatch(html+message,/ADT_RUNTIME_AUTH_SECRET|ADT_RUNTIME_WRAPPING_PUBLIC_KEY|runtime\.example/)});
