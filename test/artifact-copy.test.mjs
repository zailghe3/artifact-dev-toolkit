import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installTsxHook } from './render-tsx.mjs';

const requireTsx = installTsxHook();
const { CopyButton, copyToClipboard } = requireTsx('../components/CopyButton.tsx');
const { catalogueCopyText } = requireTsx('../components/ArtifactSearch.tsx');

test('copy action writes only the supplied reusable Markdown body', async () => {
  const writes = [];
  const body = '# Reusable\n\nCopy **this**.';
  await copyToClipboard(body, { writeText: async (value) => writes.push(value) });
  assert.deepEqual(writes, [body]);
});

test('catalogue copy selects the body rather than display or metadata fields', () => {
  const artifact = {
    body: '# Reusable body',
    description: 'Catalogue description',
    excerpt: 'Catalogue excerpt',
    renderedHtml: '<h1>Reusable body</h1>',
  };
  assert.equal(catalogueCopyText(artifact), artifact.body);
});

test('compact catalogue copy action has an accessible name and conventional copy icon', () => {
  const html = renderToStaticMarkup(React.createElement(CopyButton, {
    text: 'private reusable body',
    compact: true,
    label: 'Example artifact body',
  }));
  assert.match(html, /type="button"/);
  assert.match(html, /aria-label="Copy Example artifact body"/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
  assert.match(html, />Copy<\/button>/);
  assert.doesNotMatch(html, /private reusable body/);
});
