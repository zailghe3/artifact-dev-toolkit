import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateExternalArtifactRepository } from '../lib/external-artifact-repository.ts';

const directories = ['prompts', 'agents', 'snippets', 'templates', 'app-ideas', 'variations'];

async function createRepository(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'artifact-repository-'));
  const artifactRoot = path.join(root, 'artifacts');
  await Promise.all(directories.map((directory) => mkdir(path.join(artifactRoot, directory), { recursive: true })));
  for (const [relativePath, body] of Object.entries(files)) {
    const target = path.join(artifactRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  return root;
}

function markdown(frontMatter, body = 'Body') {
  return `---\n${frontMatter.trim()}\n---\n\n${body}\n`;
}

function errorText(result) {
  return result.errors.map((error) => `${error.file}: ${error.reason}`).join('\n');
}

test('valid external artifact repository supports all types and nested artifacts', async () => {
  const result = await validateExternalArtifactRepository('test-fixtures/external-artifact-repository/valid');

  assert.equal(result.valid, true);
  assert.equal(result.artifactCount, 6);
  assert.deepEqual(result.errors, []);
});

test('valid metadata accepts required fields, defaulted arrays, ISO timestamps with offsets, and documented unknown fields', async () => {
  const root = await createRepository({
    'prompts/minimal.md': markdown(`
id: minimal
title: Minimal Prompt
type: prompt
status: production
createdAt: '2026-07-12T09:30:00+01:00'
extraField: allowed-for-forward-compatibility
`),
  });

  const result = await validateExternalArtifactRepository(root);

  assert.equal(result.valid, true, errorText(result));
  assert.equal(result.artifactCount, 1);
  assert.deepEqual(result.errors, []);
});

test('invalid metadata reports intended Zod 4 contract categories', async () => {
  const root = await createRepository({
    'prompts/missing-required.md': markdown(`
id: missing-required
type: prompt
status: production
`),
    'agents/bad-status.md': markdown(`
id: bad-status
title: Bad Status
type: agent
status: proposed
`),
    'snippets/bad-created-at.md': markdown(`
id: bad-created-at
title: Bad Timestamp
type: snippet
status: draft
createdAt: '2026-07-12T09:30:00'
`),
    'templates/malformed-yaml.md': `---\nid: malformed\ntitle: [unterminated\n---\nBody\n`,
    'app-ideas/no-frontmatter.md': 'No front matter here.\n',
  });

  const result = await validateExternalArtifactRepository(root);
  const errors = errorText(result);

  assert.equal(result.valid, false);
  assert.match(errors, /missing-required\.md: title:/);
  assert.match(errors, /bad-status\.md: status:/);
  assert.match(errors, /bad-created-at\.md: createdAt:/);
  assert.match(errors, /malformed-yaml\.md: Unable to parse Markdown front matter:/);
  assert.match(errors, /no-frontmatter\.md: Missing YAML front matter\./);
});

test('invalid external artifact repository reports file-specific contract errors', async () => {
  const result = await validateExternalArtifactRepository('test-fixtures/external-artifact-repository/invalid');
  const errors = errorText(result);

  assert.equal(result.valid, false);
  assert.match(errors, /bad-type\.md: type:/);
  assert.match(errors, /missing-title\.md: title:/);
  assert.match(errors, /no-frontmatter\.md: Missing YAML front matter/);
  assert.match(errors, /unknown\/stray\.md: Markdown artifacts must be stored under/);
  assert.match(errors, /duplicate-app\.md: Duplicate artifact id "duplicate-id"/);
});
