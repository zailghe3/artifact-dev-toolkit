import test from 'node:test';
import assert from 'node:assert/strict';
import { addTagValue, collectTagSuggestions, comboboxEscaped, comboboxMoved, comboboxQueryChanged, filterTagSuggestions, removeTagValue, tagOptions, comboboxBlurred } from '../lib/tag-suggestions.ts';

const catalogue = [
  { tags: [' Research ', 'design', '', 'Alpha'] },
  { tags: ['Research', 'research', 'design', 'ops'] },
  { tags: ['beta', 'ops', 'alphabet', 'Gamma'] },
];

test('collectTagSuggestions aggregates exact trimmed values without mutating artifacts', () => {
  const frozen = catalogue.map((artifact) => Object.freeze({ tags: Object.freeze([...artifact.tags]) }));
  const suggestions = collectTagSuggestions(frozen);
  assert.deepEqual(suggestions.find((item) => item.value === 'Research'), { value: 'Research', count: 2 });
  assert.deepEqual(suggestions.find((item) => item.value === 'research'), { value: 'research', count: 1 });
  assert.equal(suggestions.some((item) => item.value === ''), false);
  assert.deepEqual(frozen[0].tags, [' Research ', 'design', '', 'Alpha']);
});

test('filterTagSuggestions orders prefix matches before substrings with count and alphabetic ties', () => {
  const suggestions = collectTagSuggestions(catalogue);
  assert.deepEqual(filterTagSuggestions(suggestions, 'alp', []).map((item) => item.value), ['Alpha', 'alphabet']);
  assert.deepEqual(filterTagSuggestions(suggestions, 's', []).map((item) => item.value), ['design', 'ops', 'Research', 'research']);
  assert.deepEqual(filterTagSuggestions(suggestions, 'RE', ['Research']).map((item) => item.value), ['research']);
  assert.deepEqual(filterTagSuggestions(suggestions, '', [], 3).map((item) => item.value), ['design', 'ops', 'Research']);
  assert.deepEqual(filterTagSuggestions([], '', []), []);
});

test('tag mutation helpers add suggestions, free-form values, trim, dedupe, preserve order, and remove exact tags', () => {
  const suggestions = collectTagSuggestions(catalogue);
  assert.deepEqual(addTagValue(['existing'], ' research ', suggestions), ['existing', 'Research']);
  assert.deepEqual(addTagValue(['existing'], ' custom ', suggestions), ['existing', 'custom']);
  assert.deepEqual(addTagValue(['existing'], '   ', suggestions), ['existing']);
  assert.deepEqual(addTagValue(['existing'], 'existing', suggestions), ['existing']);
  assert.deepEqual(removeTagValue(['first', 'middle', 'final'], 'first'), ['middle', 'final']);
  assert.deepEqual(removeTagValue(['first', 'middle', 'final'], 'middle'), ['first', 'final']);
  assert.deepEqual(removeTagValue(['first', 'middle', 'final'], 'final'), ['first', 'middle']);
  assert.deepEqual(addTagValue(removeTagValue(['one', 'two'], 'two'), 'two', suggestions), ['one', 'two']);
});

test('combobox state supports navigation, selection, escape, query reset, and no-op blur', () => {
  assert.deepEqual(comboboxMoved({ open: false, activeIndex: -1 }, 3, 1), { open: true, activeIndex: 0 });
  assert.deepEqual(comboboxMoved({ open: true, activeIndex: 0 }, 3, -1), { open: true, activeIndex: 2 });
  assert.deepEqual(comboboxMoved({ open: true, activeIndex: 2 }, 3, 1), { open: true, activeIndex: 0 });
  assert.deepEqual(comboboxEscaped({ open: true, activeIndex: 1 }), { open: false, activeIndex: -1 });
  assert.deepEqual(comboboxQueryChanged({ open: true, activeIndex: 4 }, 2), { open: true, activeIndex: -1 });
  const blurState = { open: true, activeIndex: 1 };
  assert.equal(comboboxBlurred(blurState), blurState);
  assert.deepEqual(tagOptions(collectTagSuggestions(catalogue), 'new', [], 8).at(-1), { kind: 'create', value: 'new', count: 0 });
});
