import test from 'node:test';
import assert from 'node:assert/strict';
import { directDeletionCompleted, directWriteCompleted, editorRequestAllowed, initialEditorLifecycle, proposalCompleted, validFileSha } from '../lib/artifact-editor-helpers.ts';

test('direct edits advance the active revision used by later operations', () => {
  const loaded = initialEditorLifecycle('abcdef12');
  assert.equal(loaded.activeFileSha, 'abcdef12');
  const saved = directWriteCompleted(loaded, '1234567abc', false);
  assert.equal(saved?.activeFileSha, '1234567abc');
  assert.equal(editorRequestAllowed(saved, 'preview'), true);
  assert.equal(editorRequestAllowed(saved, 'save'), true);
  assert.equal(editorRequestAllowed(saved, 'delete'), true);
});

test('creation locks its form and deletion permanently blocks mutations', () => {
  const created = directWriteCompleted(initialEditorLifecycle(), 'abcdef12', true);
  assert.equal(created?.completedCreation, true);
  assert.equal(editorRequestAllowed(created, 'save'), false);
  assert.equal(editorRequestAllowed(created, 'preview'), false);
  const deleted = directDeletionCompleted(initialEditorLifecycle('abcdef12'));
  for (const operation of ['preview', 'save', 'delete']) assert.equal(editorRequestAllowed(deleted, operation), false);
});

test('proposal success retains the base SHA and malformed direct results do not advance', () => {
  const loaded = initialEditorLifecycle('abcdef12');
  assert.strictEqual(proposalCompleted(loaded), loaded);
  assert.equal(directWriteCompleted(loaded, undefined, false), undefined);
  assert.equal(directWriteCompleted(loaded, 'unsafe sha', false), undefined);
  assert.equal(validFileSha('1234567'), '1234567');
});
