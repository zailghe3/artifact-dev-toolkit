import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeArtifactMetadata, parseArtifactMarkdown, toExcerpt, validateArtifactPath, validateUniqueArtifactIds } from '../lib/artifact-contract.ts';
import { slugify } from '../lib/artifact-repository.ts';
import { markdownToHtml } from '../lib/markdown.ts';
import { searchArtifacts } from '../lib/search.ts';
import { artifactLifecycleLabel, isCompatibilityReadOnly } from '../lib/artifact-presentation.ts';

const artifacts = [
  {
    id: 'deploy-checklist',
    title: 'Production Deploy Checklist',
    type: 'template',
    status: 'production',
    tags: ['release', 'operations'],
    aliases: ['ship list'],
    body: 'Verify the worker build before launch.',
  },
  {
    id: 'review-agent',
    title: 'Review Assistant',
    type: 'agent',
    status: 'draft',
    tags: ['quality', 'release'],
    aliases: ['code checker'],
    body: 'Reviews a production change for safety.',
  },
  {
    id: 'worker-prompt',
    title: 'Worker Troubleshooter',
    type: 'prompt',
    status: 'production',
    tags: ['cloudflare', 'diagnostics'],
    aliases: ['edge helper'],
    body: 'Investigate a failed deployment.',
  },
];

test('empty and whitespace-only searches return every artifact in its existing order', () => {
  assert.strictEqual(searchArtifacts(artifacts, ''), artifacts);
  assert.strictEqual(searchArtifacts(artifacts, '  \t\n '), artifacts);
  assert.deepEqual(searchArtifacts(artifacts, '').map(({ id }) => id), ['deploy-checklist', 'review-agent', 'worker-prompt']);
});

test('search is case-insensitive and ignores leading, trailing, and repeated whitespace', () => {
  assert.deepEqual(searchArtifacts(artifacts, '  PrOdUcTiOn   RELEASE  ').map(({ id }) => id), ['deploy-checklist', 'review-agent']);
});

test('multiple search terms use AND semantics rather than OR semantics', () => {
  assert.deepEqual(searchArtifacts(artifacts, 'production release').map(({ id }) => id), ['deploy-checklist', 'review-agent']);
  assert.deepEqual(searchArtifacts(artifacts, 'cloudflare release'), []);
});

test('search terms can match across different artifact fields', () => {
  assert.deepEqual(searchArtifacts(artifacts, 'assistant draft safety quality').map(({ id }) => id), ['review-agent']);
});

test('search matches title, type, status, tag, alias, and body fields', () => {
  const cases = [
    ['troubleshooter', 'worker-prompt'],
    ['template', 'deploy-checklist'],
    ['draft', 'review-agent'],
    ['diagnostics', 'worker-prompt'],
    ['checker', 'review-agent'],
    ['launch', 'deploy-checklist'],
  ];
  for (const [query, id] of cases) assert.deepEqual(searchArtifacts(artifacts, query).map((artifact) => artifact.id), [id], query);
});

test('an unmatched search returns an empty array', () => {
  assert.deepEqual(searchArtifacts(artifacts, 'database'), []);
});

test('search preserves input order without mutating the input array or its artifacts', () => {
  const input = Object.freeze([artifacts[2], artifacts[0], artifacts[1]].map((artifact) => Object.freeze({ ...artifact, tags: Object.freeze([...artifact.tags]), aliases: Object.freeze([...artifact.aliases]) })));
  assert.deepEqual(searchArtifacts(input, 'production').map(({ id }) => id), ['worker-prompt', 'deploy-checklist', 'review-agent']);
  assert.deepEqual(input.map(({ id }) => id), ['worker-prompt', 'deploy-checklist', 'review-agent']);
});

test('Markdown renders paragraphs and headings semantically', async () => {
  const html = await markdownToHtml('# Main heading\n\nA paragraph.\n\n## Subheading');
  assert.match(html, /<h1>Main heading<\/h1>/);
  assert.match(html, /<p>A paragraph\.<\/p>/);
  assert.match(html, /<h2>Subheading<\/h2>/);
});

test('Markdown renders unordered and ordered lists', async () => {
  const html = await markdownToHtml('- alpha\n- beta\n\n1. first\n2. second');
  assert.match(html, /<ul>[\s\S]*<li>alpha<\/li>[\s\S]*<li>beta<\/li>[\s\S]*<\/ul>/);
  assert.match(html, /<ol>[\s\S]*<li>first<\/li>[\s\S]*<li>second<\/li>[\s\S]*<\/ol>/);
});

test('Markdown renders emphasis, strong text, and inline code', async () => {
  const html = await markdownToHtml('Use *care*, **confidence**, and `npm test`.');
  assert.match(html, /<em>care<\/em>/);
  assert.match(html, /<strong>confidence<\/strong>/);
  assert.match(html, /<code>npm test<\/code>/);
});

test('Markdown renders fenced code blocks with their language annotation', async () => {
  const html = await markdownToHtml('```js\nconst ready = true;\n```');
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /const ready = true;/);
});

test('Markdown renders links with their destination', async () => {
  const html = await markdownToHtml('[Artifact guide](https://example.test/guide)');
  assert.match(html, /<a href="https:\/\/example\.test\/guide">Artifact guide<\/a>/);
});

test('empty Markdown renders an empty string', async () => {
  assert.equal(await markdownToHtml(''), '');
});

test('repeated Markdown conversion is stable and independent', async () => {
  const source = '**repeatable**';
  const first = await markdownToHtml(source);
  await markdownToHtml('# unrelated');
  assert.equal(await markdownToHtml(source), first);
});

test('raw script-like HTML is not emitted by the Markdown pipeline', async () => {
  const html = await markdownToHtml('<script>alert("unsafe")</script>');
  assert.equal(html, '');
  assert.doesNotMatch(html, /script|alert|unsafe/i);
});

test('slug generation normalizes punctuation, separators, unsupported characters, and length', () => {
  assert.equal(slugify('  Ship...This___Feature!!!  '), 'ship-this-feature');
  assert.equal(slugify('Crème ☕ Déjà Vu'), 'cr-me-d-j-vu');
  assert.equal(slugify(`---${'a'.repeat(100)}---`).length, 80);
  assert.doesNotMatch(slugify(`---${'a'.repeat(100)}---`), /^-|-$|--/);
});

test('artifact parsing defaults empty metadata arrays and normalizes body-derived excerpts', () => {
  const artifact = parseArtifactMarkdown('---\nid: sample\ntitle: Sample\ntype: prompt\nstatus: draft\n---\n\n First line.\n\nSecond   line. \n', 'artifacts/prompts/nested/sample.md');
  assert.deepEqual(artifact.tags, []);
  assert.deepEqual(artifact.aliases, []);
  assert.equal(artifact.body, 'First line.\n\nSecond   line.');
  assert.equal(artifact.excerpt, 'First line. Second line.');
  assert.equal(toExcerpt(` ${'word '.repeat(50)}`).length, 180);
  assert.equal(normalizeArtifactMetadata({ id: ' x ', title: ' X ', type: 'prompt', status: 'draft' }).id, 'x');
});

test('artifact paths allow supported nested directories and reject invalid top-level directories', () => {
  assert.equal(validateArtifactPath('artifacts/prompts/team/nested/example.md'), undefined);
  assert.match(validateArtifactPath('artifacts/unknown/example.md'), /stored under one of/);
  assert.match(validateArtifactPath('other/prompts/example.md'), /stored under artifacts/);
});

test('artifact IDs must be unique even when artifacts have different types and paths', () => {
  assert.throws(
    () => validateUniqueArtifactIds([{ id: 'shared', path: 'artifacts/prompts/a.md' }, { id: 'shared', path: 'artifacts/agents/b.md' }]),
    /Duplicate artifact id "shared".*artifacts\/agents\/b\.md.*artifacts\/prompts\/a\.md/,
  );
});

test('compatibility presentation never invents lifecycle status', () => {
  assert.equal(isCompatibilityReadOnly({ layout: 'future', status: 'production' }), true);
  assert.equal(isCompatibilityReadOnly({ layout: 'legacy' }), true);
  assert.equal(isCompatibilityReadOnly({ layout: 'legacy', status: 'draft' }), false);
  assert.equal(artifactLifecycleLabel({ layout: 'future' }), 'Compatibility · read-only');
  assert.equal(artifactLifecycleLabel({ layout: 'legacy', status: 'archived' }), 'archived');
});
