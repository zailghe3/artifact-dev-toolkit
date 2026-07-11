#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

export const canonicalFeatureRequestPattern = 'requests/features/*.json';

export function changedFeatureRequestFiles({ base = process.env.BASE_SHA || process.argv[2], head = process.env.HEAD_SHA || process.argv[3] || 'HEAD', git = execFileSync } = {}) {
  if (!base) throw new Error('Usage: BASE_SHA=<base> HEAD_SHA=<head> node scripts/changed-feature-requests.mjs');
  const output = git('git', [
    'diff',
    '--name-only',
    '--diff-filter=AM',
    base,
    head,
    '--',
    canonicalFeatureRequestPattern,
  ], { encoding: 'utf8' });
  return [...new Set(String(output).split('\n').filter(Boolean).filter((path) => /^requests\/features\/[^/]+\.json$/.test(path)))];
}

function main() {
  try {
    process.stdout.write(changedFeatureRequestFiles().join('\n'));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
