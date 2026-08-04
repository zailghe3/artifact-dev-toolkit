import test from 'node:test';
import assert from 'node:assert/strict';
import { directDeletionCompleted, directWriteCompleted, editorDeletionSnapshot, editorRequestAllowed, initialEditorLifecycle, proposalCompleted, validFileSha } from '../lib/artifact-editor-helpers.ts';
import { deletionConfirmation, deletionRequest } from '../lib/deletion-ui.ts';

test('direct edits advance the active revision used by later operations', () => {
  const loaded = initialEditorLifecycle('abcdef12', 'Original title');
  const snapshot = editorDeletionSnapshot(loaded, { id: 'artifact-id', status: 'production' });
  assert.match(deletionConfirmation(snapshot).heading, /Original title \(artifact-id\)/);
  assert.deepEqual(deletionRequest(snapshot), { endpoint: '/api/artifacts/artifact-id/deletion-proposal', method: 'POST', body: { currentFileSha: 'abcdef12' } });
  const saved = directWriteCompleted(loaded, '1234567abc', 'Saved title', false);
  assert.equal(saved?.activeFileSha, '1234567abc');
  assert.equal(editorRequestAllowed(saved, 'preview'), true);
  assert.equal(editorRequestAllowed(saved, 'save'), true);
  assert.equal(editorRequestAllowed(saved, 'delete'), true);
});

test('creation locks its form and deletion permanently blocks mutations', () => {
  const created = directWriteCompleted(initialEditorLifecycle(), 'abcdef12', 'Created title', true);
  assert.equal(created?.completedCreation, true);
  assert.equal(editorRequestAllowed(created, 'save'), false);
  assert.equal(editorRequestAllowed(created, 'preview'), false);
  const deleted = directDeletionCompleted(initialEditorLifecycle('abcdef12', 'Original title'));
  for (const operation of ['preview', 'save', 'delete']) assert.equal(editorRequestAllowed(deleted, operation), false);
});

test('proposal success retains the base SHA and malformed direct results do not advance', () => {
  const loaded = initialEditorLifecycle('abcdef12', 'Original title');
  assert.strictEqual(proposalCompleted(loaded), loaded);
  assert.equal(directWriteCompleted(loaded, undefined, 'Saved title', false), undefined);
  assert.equal(directWriteCompleted(loaded, 'unsafe sha', 'Saved title', false), undefined);
  assert.equal(validFileSha('1234567'), '1234567');
});

test('unsaved edits and previews retain the persisted deletion identity and active SHA', () => {
  const loaded = initialEditorLifecycle('abcdef12', 'Original title');
  const editableTitle = 'Unsaved title';
  assert.equal(editableTitle, 'Unsaved title');
  assert.equal(proposalCompleted(loaded).persistedTitle, 'Original title');
  const snapshot = editorDeletionSnapshot(proposalCompleted(loaded), { id: 'artifact-id', status: 'draft' });
  assert.match(deletionConfirmation(snapshot).heading, /Original title \(artifact-id\)/);
  assert.deepEqual(deletionRequest(snapshot).body, { currentFileSha: 'abcdef12' });
});

test('a validated direct save advances persisted deletion identity and active SHA together', () => {
  const loaded = initialEditorLifecycle('abcdef12', 'Original title');
  const saved = directWriteCompleted(loaded, '12345678', 'Saved title', false);
  assert.equal(saved?.persistedTitle, 'Saved title');
  const snapshot = editorDeletionSnapshot(saved, { id: 'artifact-id', status: 'draft' });
  assert.match(deletionConfirmation(snapshot).heading, /Saved title \(artifact-id\)/);
  assert.deepEqual(deletionRequest(snapshot).body, { currentFileSha: '12345678' });
});

test('proposal and failed response transitions never advance persisted identity', () => {
  const loaded = initialEditorLifecycle('abcdef12', 'Original title');
  for (const failure of [
    directWriteCompleted(loaded, undefined, 'Proposed title', false),
    directWriteCompleted(loaded, '12345678', undefined, false),
    directWriteCompleted(loaded, '12345678', '', false),
  ]) assert.equal(failure, undefined);
  assert.strictEqual(proposalCompleted(loaded), loaded);
  assert.equal(loaded.persistedTitle, 'Original title');
  const snapshot = editorDeletionSnapshot(loaded, { id: 'artifact-id', status: 'production' });
  assert.match(deletionConfirmation(snapshot).heading, /Original title \(artifact-id\)/);
  assert.deepEqual(deletionRequest(snapshot), { endpoint: '/api/artifacts/artifact-id/deletion-proposal', method: 'POST', body: { currentFileSha: 'abcdef12' } });
});
