import test from 'node:test';
import assert from 'node:assert/strict';

import { validateExternalArtifactRepository } from '../lib/external-artifact-repository.ts';

test('valid external artifact repository supports all types and nested artifacts', async () => {
  const result = await validateExternalArtifactRepository('test-fixtures/external-artifact-repository/valid');

  assert.equal(result.valid, true);
  assert.equal(result.artifactCount, 6);
  assert.deepEqual(result.errors, []);
});

test('invalid external artifact repository reports file-specific contract errors', async () => {
  const result = await validateExternalArtifactRepository('test-fixtures/external-artifact-repository/invalid');

  assert.equal(result.valid, false);
  assert.match(result.errors.map((error) => `${error.file}: ${error.reason}`).join('\n'), /bad-type\.md: type:/);
  assert.match(result.errors.map((error) => `${error.file}: ${error.reason}`).join('\n'), /missing-title\.md: title:/);
  assert.match(result.errors.map((error) => `${error.file}: ${error.reason}`).join('\n'), /no-frontmatter\.md: Missing YAML front matter/);
  assert.match(result.errors.map((error) => `${error.file}: ${error.reason}`).join('\n'), /unknown\/stray\.md: Markdown artifacts must be stored under/);
  assert.match(result.errors.map((error) => `${error.file}: ${error.reason}`).join('\n'), /duplicate-app\.md: Duplicate artifact id "duplicate-id"/);
});
