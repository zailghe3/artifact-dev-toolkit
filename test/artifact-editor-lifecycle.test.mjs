import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEditorSnapshot, directDeletionCompleted, directWriteCompleted, editorDeletionSnapshot, editorRequestAllowed, editorValuesAreDirty, initialEditorLifecycle, liveEditorValuesAreDirty, proposalCompleted, validFileSha, validatedCanonicalEditorSnapshot } from '../lib/artifact-editor-helpers.ts';
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

test('canonical dirty state clears after reverting every editable value', () => {
  const persisted = canonicalEditorSnapshot({ title: 'Original', tags: ['one'], aliases: ['alias'], body: 'Body' });
  assert.equal(editorValuesAreDirty(canonicalEditorSnapshot({ ...persisted, title: 'Changed' }), persisted), true);
  assert.equal(editorValuesAreDirty(canonicalEditorSnapshot({ title: ' Original ', tags: [' one '], aliases: ['alias'], body: '\nBody\n' }), persisted), false);
});


test('live dirty checks tolerate invalid transient titles and restore clean state', () => {
  const persisted = canonicalEditorSnapshot({ title: 'Original title', tags: ['one'], aliases: ['alias'], body: 'Body' });
  assert.equal(liveEditorValuesAreDirty({ title: '', tags: ['one'], aliases: ['alias'], body: 'Body' }, persisted), true);
  assert.equal(liveEditorValuesAreDirty({ title: '   ', tags: ['one'], aliases: ['alias'], body: 'Body' }, persisted), true);
  assert.equal(liveEditorValuesAreDirty({ title: 'Changed title', tags: ['one'], aliases: ['alias'], body: 'Body' }, persisted), true);
  assert.equal(liveEditorValuesAreDirty({ title: 'Original title', tags: ['one'], aliases: ['alias'], body: 'Body' }, persisted), false);
  assert.equal(liveEditorValuesAreDirty({ title: '  Original title  ', tags: [' one ', 'one', ''], aliases: [' alias ', '', 'alias'], body: '\nBody\n' }, persisted), false);
});

test('live dirty checks treat malformed representable list values as dirty without throwing', () => {
  const persisted = canonicalEditorSnapshot({ title: 'Original title', tags: ['one'], aliases: ['alias'], body: 'Body' });
  assert.equal(liveEditorValuesAreDirty({ title: 'Original title', tags: ['one', 42], aliases: ['alias'], body: 'Body' }, persisted), true);
  assert.equal(liveEditorValuesAreDirty({ title: 'Original title', tags: ['one'], aliases: ['alias', { bad: true }], body: 'Body' }, persisted), true);
});

test('validated server snapshots remain strict while successful saves advance canonical state', () => {
  assert.throws(() => validatedCanonicalEditorSnapshot({ title: '', tags: [], aliases: [], body: 'Body' }));
  assert.equal(validatedCanonicalEditorSnapshot({ title: ' Server title ', tags: [], aliases: [], body: 'Body' }), undefined);
  const loaded = initialEditorLifecycle('abcdef12', 'Original title');
  const savedEditor = validatedCanonicalEditorSnapshot({ title: 'Saved title', tags: ['tag'], aliases: ['alias'], body: 'Saved body' });
  const savedLifecycle = directWriteCompleted(loaded, '12345678', savedEditor?.title, false);
  assert.deepEqual(savedEditor, { title: 'Saved title', tags: ['tag'], aliases: ['alias'], body: 'Saved body' });
  assert.equal(savedLifecycle?.persistedTitle, 'Saved title');
  assert.equal(liveEditorValuesAreDirty(savedEditor, savedEditor), false);
  assert.throws(() => validatedCanonicalEditorSnapshot({ title: '   ', tags: [], aliases: [], body: 'Body' }));
});

test('direct-save snapshots apply shared title, list, and body normalization', () => {
  const saved = canonicalEditorSnapshot({ title: '  Saved title  ', tags: [' tag ', 'tag', 'two'], aliases: [' alias ', '', 'alias'], body: '\n Saved body \n' });
  assert.deepEqual(saved, { title: 'Saved title', tags: ['tag', 'two'], aliases: ['alias'], body: 'Saved body' });
  assert.equal(editorValuesAreDirty(saved, saved), false);
});

test('preview, failed save, and proposal do not advance the persisted editor snapshot', () => {
  const persisted = canonicalEditorSnapshot({ title: 'Base', tags: [], aliases: [], body: 'Base body' });
  const edited = canonicalEditorSnapshot({ ...persisted, body: 'Proposed body' });
  assert.equal(editorValuesAreDirty(edited, persisted), true);
  for (const unchanged of [persisted, persisted, persisted]) assert.equal(editorValuesAreDirty(edited, unchanged), true);
});
