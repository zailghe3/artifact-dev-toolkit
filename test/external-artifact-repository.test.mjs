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

async function createRepositoryAtRoot(artifactRoot, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'artifact-repository-layout-'));
  for (const [relativePath, body] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  return { root, validate: () => validateExternalArtifactRepository(root, { artifactRoot }) };
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

test('compatibility validation accepts future-only status-bearing and statusless Markdown', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'future-artifact-repository-'));
  await mkdir(path.join(root, 'prompts'), { recursive: true });
  await writeFile(path.join(root, 'prompts/statusless.md'), markdown('id: statusless\ntitle: Statusless\ntype: prompt\ntags: []\naliases: []'));
  await writeFile(path.join(root, 'prompts/status.md'), markdown('id: status\ntitle: Status\ntype: prompt\nstatus: production\ntags: []\naliases: []'));
  const result = await validateExternalArtifactRepository(root);
  assert.equal(result.valid, true, errorText(result));
  assert.equal(result.artifactCount, 2);
});

test('compatibility validation accepts non-conflicting mixed layouts and rejects cross-layout IDs', async () => {
  const root = await createRepository({ 'prompts/legacy.md': markdown('id: legacy\ntitle: Legacy\ntype: prompt\nstatus: draft') });
  await mkdir(path.join(root, 'prompts'), { recursive: true });
  await writeFile(path.join(root, 'prompts/root.md'), markdown('id: root\ntitle: Root\ntype: prompt'));
  assert.equal((await validateExternalArtifactRepository(root)).valid, true);
  await writeFile(path.join(root, 'prompts/duplicate.md'), markdown('id: legacy\ntitle: Duplicate\ntype: prompt'));
  const duplicate = await validateExternalArtifactRepository(root);
  assert.equal(duplicate.valid, false);
  assert.match(errorText(duplicate), /Duplicate artifact id "legacy".*artifacts\/prompts\/legacy\.md/);
});

test('overlapping single-segment root classifies each path once using the complete legacy path', async () => {
  const repository = await createRepositoryAtRoot('prompts', {
    'prompts/prompts/legacy.md': markdown('id: legacy\ntitle: Legacy\ntype: prompt\nstatus: draft'),
    'prompts/future.md': markdown('id: future\ntitle: Future\ntype: prompt'),
  });
  const result = await repository.validate();
  assert.equal(result.valid, true, errorText(result));
  assert.equal(result.artifactCount, 2);

  await writeFile(path.join(repository.root, 'prompts/prompts/legacy.md'), markdown('id: legacy\ntitle: Legacy\ntype: prompt'));
  const statuslessLegacy = await repository.validate();
  assert.equal(statuslessLegacy.valid, true, errorText(statuslessLegacy));
  assert.doesNotMatch(errorText(statuslessLegacy), /Duplicate artifact id/);
});

test('overlapping nested root does not rediscover legacy Markdown through its future root', async () => {
  const repository = await createRepositoryAtRoot('prompts/team', {
    'prompts/team/prompts/legacy.md': markdown('id: nested\ntitle: Nested\ntype: prompt\nstatus: production'),
    'prompts/future.md': markdown('id: future\ntitle: Future\ntype: prompt'),
  });
  const result = await repository.validate();
  assert.equal(result.valid, true, errorText(result));
  assert.equal(result.artifactCount, 2);
  assert.doesNotMatch(errorText(result), /Duplicate artifact id/);
});

test('normal multi-segment and reserved-name roots use runtime layout classification', async () => {
  for (const [artifactRoot, legacyPath] of [
    ['team/artifacts', 'team/artifacts/prompts/legacy.md'],
    ['artifacts', 'artifacts/prompts/legacy.md'],
  ]) {
    const repository = await createRepositoryAtRoot(artifactRoot, {
      [legacyPath]: markdown('id: legacy\ntitle: Legacy\ntype: prompt\nstatus: archived'),
      'prompts/future.md': markdown('id: future\ntitle: Future\ntype: prompt'),
    });
    const result = await repository.validate();
    assert.equal(result.valid, true, `${artifactRoot}: ${errorText(result)}`);
    assert.equal(result.artifactCount, 2);
  }
});

test('distinct legacy and future paths still report a global logical ID collision', async () => {
  const repository = await createRepositoryAtRoot('prompts', {
    'prompts/prompts/legacy.md': markdown('id: collision\ntitle: Legacy\ntype: prompt\nstatus: production'),
    'prompts/future.md': markdown('id: collision\ntitle: Future\ntype: prompt'),
  });
  const result = await repository.validate();
  assert.equal(result.valid, false);
  assert.match(errorText(result), /Duplicate artifact id "collision"/);
  assert.match(errorText(result), /prompts\/prompts\/legacy\.md/);
  assert.match(errorText(result), /prompts\/future\.md/);
});

test('unsafe configured roots are rejected before repository traversal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'unsafe-artifact-root-'));
  for (const artifactRoot of ['../artifacts', 'team/../artifacts', 'team//artifacts', '.', '']) {
    const result = await validateExternalArtifactRepository(root, { artifactRoot });
    assert.equal(result.valid, false, artifactRoot);
    assert.equal(result.artifactCount, 0);
    assert.match(errorText(result), /safe repository-relative path/);
  }
});
