import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseArtifactMarkdown, serializeArtifactMarkdown } from '../lib/artifact-contract.ts';
import { parseKnowledge, serializeKnowledge } from '../lib/advisor-knowledge.ts';

const metadata = { id: 'review', title: 'Review', type: 'prompt', tags: ['one'], createdAt: '2026-11-28T08:00:00.000Z' };
const knowledgePath = 'advisor/knowledge/review.md';
const document = (header, body = 'Review notes') => `---\n${header}\n---\n${body}\n`;

test('artifact and Advisor readers reject unsupported front matter without echoing it', () => {
  const invalid = [
    '---javascript\nThis language is unsupported.\n---\nReview notes',
    document('id: !unknown review'),
    document('title: &note Review\naliases: [*note]'),
    document('id: first\nid: second'),
    document('id: [ '),
    document('__proto__: {}'),
    document(`ignored: ${'['.repeat(30)}0${']'.repeat(30)}`),
    document(`ignored: [${'x,'.repeat(4200)}y]`),
    document(`ignored: ${'é'.repeat(20_000)}`),
    '---\nid: review\nMissing closing delimiter',
  ];
  for (const value of invalid) {
    assert.throws(() => parseArtifactMarkdown(value, 'artifact.md'), { code: 'invalid_front_matter', message: 'Artifact Markdown is invalid.' });
    assert.throws(() => parseKnowledge(value, knowledgePath), /^Error: knowledge_invalid$/);
  }
});

test('valid YAML still goes through each metadata schema', () => {
  assert.throws(() => parseArtifactMarkdown(document('id: review\ntitle: Review\ntype: incorrect'), 'artifact.md'), { code: 'invalid_metadata' });
  assert.throws(() => parseKnowledge(document('id: review\ntitle: Review\ntype: finding\nstatus: hidden'), knowledgePath), /knowledge_invalid/);
});

test('canonical artifacts preserve timestamp normalization, defaults, CRLF, and the Markdown body', async () => {
  const path = 'prompts/discovery-prompt.md';
  const file = await readFile(new URL(`../test-fixtures/external-artifact-repository/valid/artifacts/${path}`, import.meta.url), 'utf8');
  assert.deepEqual(parseArtifactMarkdown(file.replaceAll('\n', '\r\n'), path).tags, parseArtifactMarkdown(file, path).tags);
  const legacy = parseArtifactMarkdown(document('id: review\ntitle: Review\ntype: prompt\ncreatedAt: 2026-11-28'), 'artifact.md');
  assert.equal(legacy.createdAt, '2026-11-28T00:00:00.000Z');
  assert.deepEqual(legacy.aliases, []);

  const body = '---\n\n# Generated notes\n\n```yaml\nstatus: active\n---\n```\n\nAn AI-generated paragraph.';
  const artifact = parseArtifactMarkdown(serializeArtifactMarkdown(metadata, body), 'artifact.md');
  assert.equal(artifact.createdAt, metadata.createdAt);
  assert.deepEqual(artifact.tags, metadata.tags);
  assert.equal(artifact.body, body);
  const knowledge = { metadata: { ...metadata, type: 'finding', status: 'active', evidence: [{ revision: 'commit', source: 'review' }] }, body };
  const parsed = parseKnowledge(serializeKnowledge(knowledge), knowledgePath);
  assert.equal(parsed.body, body);
  assert.deepEqual(parsed.metadata.evidence, knowledge.metadata.evidence);
  assert.equal(parsed.metadata.createdAt, metadata.createdAt);
});
