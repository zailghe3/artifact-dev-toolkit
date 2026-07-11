import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFeatureIssue } from './render-feature-issue.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const featureSchema = JSON.parse(readFileSync(resolve(repoRoot, '.github/ISSUE_TEMPLATE/feature-schema.json'), 'utf8'));
const contract = readFileSync(resolve(repoRoot, featureSchema.contractPath), 'utf8').trim();

function valueFor(data, field) {
  return data[field.key] ?? data[field.id];
}

function normalizeBodyValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join('\n');
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function parseFeatureRequestFile(filePath) {
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), filePath), 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read or parse JSON: ${error.message}`);
  }
}

export function validateFeatureRequestData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Feature request must be a JSON object.');
  }

  const requestId = String(data.requestId ?? '').trim();
  if (!requestId) {
    throw new Error('Missing required orchestration field: requestId.');
  }

  const missing = featureSchema.fields
    .filter((field) => field.required && normalizeBodyValue(valueFor(data, field)).length === 0)
    .map((field) => `${field.key} (${field.id})`);

  if (missing.length > 0) {
    throw new Error(`Missing required feature issue field(s): ${missing.join(', ')}`);
  }

  const rendered = renderFeatureIssue(data);
  const missingRenderedSections = featureSchema.fields
    .filter((field) => !rendered.includes(`## ${field.label}`))
    .map((field) => field.label);

  if (missingRenderedSections.length > 0) {
    throw new Error(`Rendered issue is missing section(s): ${missingRenderedSections.join(', ')}`);
  }

  if (!rendered.includes(contract)) {
    throw new Error('Rendered issue is missing the full Codex execution contract.');
  }

  const missingDoneItems = featureSchema.definitionOfDone.options.filter((option) => !rendered.includes(`- [ ] ${option}`));
  if (missingDoneItems.length > 0) {
    throw new Error(`Rendered issue is missing definition-of-done item(s): ${missingDoneItems.join(', ')}`);
  }

  return rendered;
}

export function validateFeatureRequestFile(filePath) {
  return validateFeatureRequestData(parseFeatureRequestFile(filePath));
}
