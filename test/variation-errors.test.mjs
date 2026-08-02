import assert from 'node:assert/strict';
import test from 'node:test';
import { unknownVariationErrorMessage, variationErrorMessage } from '../lib/variation-errors.ts';

const expected = {
  validation_failed: 'Enter a valid title and non-empty body.',
  secret_rejected: 'The variation contains content that resembles a secret or API key.',
  artifact_too_large: 'The variation is too large to save.',
  duplicate_artifact: 'A variation with this generated ID already exists. Try saving again.',
  write_permission_required: 'The GitHub App does not have permission to create variations.',
  repository_authentication_failed: 'GitHub repository authentication failed. Sign in again or contact the administrator.',
  repository_unavailable: 'The artifact repository is temporarily unavailable. Try again.',
  repository_configuration: 'Variation storage is not correctly configured.',
};

test('variation error codes map to safe actionable messages', () => {
  for (const [code, message] of Object.entries(expected)) assert.equal(variationErrorMessage(code), message);
});

test('unknown and malformed variation errors use a safe fallback', () => {
  for (const value of ['internal_error', undefined, null, { raw: 'exception' }]) assert.equal(variationErrorMessage(value), unknownVariationErrorMessage);
});
