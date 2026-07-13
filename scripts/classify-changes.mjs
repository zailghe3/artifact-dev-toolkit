#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';

const canonicalFeatureRe = /^requests\/features\/[^/]+\.json$/;
const exactSensitive = new Set(['package.json', 'package-lock.json', 'wrangler.jsonc']);
const exactLockfileRepairRelevant = new Set(['package.json', 'package-lock.json', '.nvmrc', '.node-version', '.npmrc', 'npm-shrinkwrap.json']);

function normalize(path) { return String(path ?? '').replace(/^\.\//, ''); }
export function isCanonicalFeaturePath(path) { return canonicalFeatureRe.test(normalize(path)); }
export function isSensitivePath(path) {
  const p = normalize(path);
  return p.startsWith('.github/workflows/') || p.startsWith('.github/actions/') || p.startsWith('scripts/') || exactSensitive.has(p) || /^open-next\.config\..+$/.test(p);
}
export function isLockfileRepairRelevantPath(path) {
  const p = normalize(path);
  return exactLockfileRepairRelevant.has(p) || p === '.github/dependabot.yml' || p.startsWith('.github/dependabot/') || p.startsWith('.github/workflows/') || p.startsWith('.github/actions/');
}
export function isDocumentationOrRequestPath(path) {
  const p = normalize(path);
  return p.startsWith('docs/') || p.startsWith('specs/') || p.startsWith('requests/features/') || p === 'README.md' || /^[^/]+\.md$/.test(p);
}

function unique(values) { return [...new Set(values.filter(Boolean).map(normalize))].sort(); }
export function classifyChanges(files) {
  const normalized = files.map((file) => ({ filename: normalize(file.filename ?? file.path), previous_filename: file.previous_filename ? normalize(file.previous_filename) : undefined, status: file.status ?? 'modified' })).filter((f) => f.filename);
  const allPaths = unique(normalized.flatMap((f) => [f.filename, f.previous_filename]));
  const canonicalFeatureFiles = unique(normalized.flatMap((f) => [f.filename, f.previous_filename]).filter(isCanonicalFeaturePath));
  const sensitiveFiles = unique(normalized.flatMap((f) => [f.filename, f.previous_filename]).filter(isSensitivePath));
  const lockfileRepairFiles = unique(normalized.flatMap((f) => [f.filename, f.previous_filename]).filter(isLockfileRepairRelevantPath));
  const documentationRequestOnly = allPaths.length > 0 && allPaths.every(isDocumentationOrRequestPath);
  return {
    changed_files: allPaths.join('\n'),
    canonical_feature_files: canonicalFeatureFiles.join('\n'),
    sensitive_files: sensitiveFiles.join('\n'),
    has_changes: allPaths.length > 0,
    has_feature_request_changes: canonicalFeatureFiles.length > 0,
    has_sensitive_changes: sensitiveFiles.length > 0,
    lockfile_repair_files: lockfileRepairFiles.join('\n'),
    has_lockfile_repair_changes: lockfileRepairFiles.length > 0,
    documentation_request_only: documentationRequestOnly,
    deployable_changes: allPaths.length > 0 && !documentationRequestOnly,
  };
}

function parseInput(path) {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text);
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function writeOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  const stringValue = typeof value === 'boolean' ? String(value) : String(value ?? '');
  if (out) appendFileSync(out, `${name}<<EOF\n${stringValue}\nEOF\n`);
  else console.log(`${name}=${JSON.stringify(stringValue)}`);
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/classify-changes.mjs files.jsonl');
  const result = classifyChanges(parseInput(input));
  for (const [key, value] of Object.entries(result)) writeOutput(key, value);
  console.log(JSON.stringify(result, null, 2));
}
