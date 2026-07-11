#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const base = process.env.BASE_SHA || process.argv[2];
const head = process.env.HEAD_SHA || process.argv[3] || 'HEAD';
if (!base) {
  console.error('Usage: BASE_SHA=<base> HEAD_SHA=<head> node scripts/changed-pending-feature-requests.mjs');
  process.exit(1);
}

const output = execFileSync('git', [
  'diff',
  '--name-only',
  '--diff-filter=AM',
  base,
  head,
  '--',
  'requests/features/pending/*.json',
], { encoding: 'utf8' });

process.stdout.write([...new Set(output.split('\n').filter(Boolean))].join('\n'));
