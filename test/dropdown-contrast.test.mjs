import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
const promptSelector=fs.readFileSync(new URL('../components/WorkflowAgentPromptSelector.tsx',import.meta.url),'utf8');
const tagCombobox=fs.readFileSync(new URL('../components/TagCombobox.tsx',import.meta.url),'utf8');

test('native dropdown contrast defines explicit enabled, placeholder, disabled, option, and focus states',()=>{
 for(const token of [
  '--adt-select-bg: #fff;',
  '--adt-select-text: #0f172a;',
  '--adt-select-border: #cbd5e1;',
  '--adt-select-placeholder: #64748b;',
  '--adt-select-disabled-bg: #f1f5f9;',
  '--adt-select-disabled-text: #64748b;',
  '--adt-select-option-disabled-text: #94a3b8;',
  '--adt-select-active-bg: #e0f2fe;',
  '--adt-select-focus: #0369a1;',
  '--adt-select-bg: #020617;',
  '--adt-select-text: #f1f5f9;',
  '--adt-select-border: #475569;',
  '--adt-select-placeholder: #94a3b8;',
  '--adt-select-disabled-bg: #0f172a;',
  '--adt-select-disabled-text: #64748b;',
  '--adt-select-active-bg: rgba(249, 115, 22, 0.2);',
  '--adt-select-focus: #fb923c;',
 ]) assert.ok(css.includes(token),`missing ${token}`);
 assert.match(css,/select\s*\{[^}]*background-color:\s*var\(--adt-select-bg\)[^}]*color:\s*var\(--adt-select-text\)[^}]*opacity:\s*1/s);
 assert.match(css,/select option:disabled\s*\{[^}]*var\(--adt-select-option-disabled-text\)/s);
 assert.match(css,/select:disabled\s*\{[^}]*var\(--adt-select-disabled-bg\)[^}]*var\(--adt-select-disabled-text\)[^}]*opacity:\s*1/s);
 assert.match(css,/select:required:invalid\s*\{[^}]*var\(--adt-select-placeholder\)/s);
 assert.match(css,/select:focus-visible\s*\{[^}]*var\(--adt-select-focus\)/s);
});

test('custom listboxes share the same explicit active and normal contrast contract',()=>{
 assert.match(css,/\.adt-listbox\s*\{[^}]*var\(--adt-select-bg\)[^}]*var\(--adt-select-text\)/s);
 assert.match(css,/\.adt-listbox \[role="option"\]\[aria-selected="true"\]\s*\{[^}]*var\(--adt-select-active-bg\)[^}]*var\(--adt-select-active-text\)/s);
 assert.match(promptSelector,/role="listbox"[^>]*className="adt-listbox /);
 assert.match(tagCombobox,/role="listbox"[^>]*className="adt-listbox /);
});
