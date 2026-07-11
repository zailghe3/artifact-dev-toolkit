#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(resolve(repoRoot, '.github/ISSUE_TEMPLATE/feature-schema.json'), 'utf8'));

function valueFor(data, field) {
  return data[field.key] ?? data[field.id];
}

function normalizeBodyValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join('\n');
  }
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function renderFeatureIssue(data) {
  const missing = schema.fields
    .filter((field) => field.required && normalizeBodyValue(valueFor(data, field)).length === 0)
    .map((field) => `${field.key} (${field.id})`);

  if (missing.length > 0) {
    throw new Error(`Missing required feature issue field(s): ${missing.join(', ')}`);
  }

  const contract = readFileSync(resolve(repoRoot, schema.contractPath), 'utf8').trim();
  const sections = [contract];

  for (const field of schema.fields) {
    const body = normalizeBodyValue(valueFor(data, field));
    sections.push(`## ${field.label}\n\n${body || '_Not specified._'}`);
  }

  const doneItems = schema.definitionOfDone.options.map((option) => `- [ ] ${option}`).join('\n');
  sections.splice(sections.length - 1, 0, `## ${schema.definitionOfDone.label}\n\n${doneItems}`);

  return `${sections.join('\n\n')}\n`;
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: npm run issue:render -- path/to/feature.json');
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(resolve(process.cwd(), inputPath), 'utf8'));
  } catch (error) {
    console.error(`Unable to read feature issue data from ${inputPath}: ${error.message}`);
    process.exit(1);
  }

  try {
    process.stdout.write(renderFeatureIssue(data));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
