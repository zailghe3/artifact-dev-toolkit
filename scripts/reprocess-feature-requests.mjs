#!/usr/bin/env node
import { appendFileSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { allFeatureRequests, featureRequestDir, featureRequestPattern, loadAndRenderRequest, requestIdFromDataOrPath } from './create-feature-issues-from-requests.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function normalizeSpecificPath(input) {
  let path = String(input ?? '').trim();
  while (path.startsWith('./')) path = path.slice(2);
  return path;
}

export function validateSpecificFeaturePath(input, { exists = (path) => existsSync(resolve(repoRoot, path)) } = {}) {
  const path = normalizeSpecificPath(input);
  if (!path) throw new Error('A non-empty file input is required when mode is specific.');
  if (path.startsWith('/') || path.includes('..')) throw new Error(`Rejected unsafe feature request path: ${path}`);
  if (!featureRequestPattern.test(path)) throw new Error(`Feature request path must match ${featureRequestDir}/<filename>.json: ${path}`);
  if (!exists(path)) throw new Error(`Feature request file does not exist at the checked-out main commit: ${path}`);
  const { data, requestId } = loadAndRenderRequest(path);
  if (requestId !== basename(path, '.json') || requestIdFromDataOrPath(data, path) !== basename(path, '.json')) {
    throw new Error(`${path} is not a canonical feature-request file.`);
  }
  return path;
}

export function discoverFeaturePaths({ gitExec } = {}) {
  return allFeatureRequests({ gitExec }).sort((a, b) => a.localeCompare(b));
}

export function validateReprocessSelection({ mode, file, gitExec } = {}) {
  if (mode !== 'specific' && mode !== 'all') throw new Error('mode must be either specific or all.');
  if (mode === 'specific') return [validateSpecificFeaturePath(file)];
  return discoverFeaturePaths({ gitExec });
}

function main() {
  const mode = process.env.REPROCESS_MODE || 'specific';
  const file = process.env.REPROCESS_FILE || '';
  const paths = validateReprocessSelection({ mode, file });
  if (paths.length === 0) {
    console.log('No canonical feature request JSON files found under requests/features/.');
  } else {
    console.log(paths.join('\n'));
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `files<<EOF\n${paths.join('\n')}\nEOF\ncount=${paths.length}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
