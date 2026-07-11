#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const yml = readFileSync(resolve(repoRoot, '.github/ISSUE_TEMPLATE/feature.yml'), 'utf8');
const schema = JSON.parse(readFileSync(resolve(repoRoot, '.github/ISSUE_TEMPLATE/feature-schema.json'), 'utf8'));
const contract = readFileSync(resolve(repoRoot, schema.contractPath), 'utf8').trim();

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const contractStart = yml.indexOf('        ## Codex execution contract');
const contractEnd = yml.indexOf('\n  - type:', contractStart + 1);
const formContract = yml
  .slice(contractStart, contractEnd === -1 ? yml.length : contractEnd)
  .split('\n')
  .map((line) => line.startsWith('        ') ? line.slice(8) : line)
  .join('\n')
  .trim();

if (formContract !== contract) {
  fail('Feature issue form Codex execution contract has drifted from the canonical shared contract. Update .github/ISSUE_TEMPLATE/shared/codex-execution-contract.md and feature.yml together.');
}

for (const field of schema.fields) {
  if (!yml.includes(`id: ${field.id}`)) fail(`Missing feature form field id: ${field.id}`);
  if (!yml.includes(`label: ${field.label}`)) fail(`Missing feature form label for ${field.id}: ${field.label}`);
  if (field.required) {
    const idIndex = yml.indexOf(`id: ${field.id}`);
    const nextIndex = yml.indexOf('\n  - type:', idIndex + 1);
    const block = yml.slice(idIndex, nextIndex === -1 ? yml.length : nextIndex);
    if (!block.includes('required: true')) fail(`Required field is not marked required in feature.yml: ${field.id}`);
  }
}

for (const option of schema.definitionOfDone.options) {
  if (!yml.includes(`label: ${option}`)) fail(`Missing definition-of-done option in feature.yml: ${option}`);
}

if (!process.exitCode) console.log('Feature issue template validation passed.');
