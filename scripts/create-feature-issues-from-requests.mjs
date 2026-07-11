#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFeatureIssue } from './render-feature-issue.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pendingDir = 'requests/features/pending';
const processedDir = 'requests/features/processed';
const failedDir = 'requests/features/failed';

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function changedPendingRequests() {
  const before = process.env.BEFORE_SHA;
  const after = process.env.AFTER_SHA || 'HEAD';

  if (!before || /^0+$/.test(before)) {
    return git(['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=A', '-r', after, '--', `${pendingDir}/`])
      .split('\n')
      .filter(Boolean);
  }

  return git(['diff', '--name-only', '--diff-filter=A', before, after, '--', `${pendingDir}/`])
    .split('\n')
    .filter(Boolean);
}

function allPendingRequests() {
  return git(['ls-files', `${pendingDir}/*.json`]).split('\n').filter(Boolean);
}

function requestPaths() {
  const mode = process.env.FEATURE_REQUEST_MODE || 'added';
  const paths = mode === 'all-pending' ? allPendingRequests() : changedPendingRequests();
  return [...new Set(paths)].filter((path) => path.endsWith('.json'));
}

function issueTitle(data) {
  const featureId = String(data.featureId ?? data['feature-id'] ?? '').trim();
  const explicitTitle = String(data.title ?? '').trim();
  if (explicitTitle) return featureId ? `[${featureId}]: ${explicitTitle}` : explicitTitle;

  const objective = String(data.objective ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? 'Feature request';
  const compactObjective = objective.length > 90 ? `${objective.slice(0, 87).trimEnd()}...` : objective;
  return featureId ? `[${featureId}]: ${compactObjective}` : compactObjective;
}

function labelsFor(data) {
  const configured = Array.isArray(data.labels) ? data.labels : ['type:feature', 'status:ready-for-codex'];
  return configured.flatMap((label) => ['--label', String(label)]);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function moveWithMetadata(sourcePath, targetDir, metadata) {
  const sourceAbsolute = resolve(repoRoot, sourcePath);
  const base = basename(sourcePath);
  const targetPath = `${targetDir}/${base}`;
  const targetAbsolute = resolve(repoRoot, targetPath);

  mkdirSync(resolve(repoRoot, targetDir), { recursive: true });
  renameSync(sourceAbsolute, targetAbsolute);

  const original = JSON.parse(readFileSync(targetAbsolute, 'utf8'));
  writeFileSync(targetAbsolute, `${JSON.stringify({ ...original, processing: metadata }, null, 2)}\n`);
  return targetPath;
}

function createIssue(requestPath) {
  const absolutePath = resolve(repoRoot, requestPath);
  const data = JSON.parse(readFileSync(absolutePath, 'utf8'));
  const body = renderFeatureIssue(data);
  const bodyPath = resolve(repoRoot, `.feature-issue-body-${timestamp()}.md`);
  writeFileSync(bodyPath, body);

  try {
    const issueUrl = execFileSync('gh', ['issue', 'create', '--title', issueTitle(data), '--body-file', bodyPath, ...labelsFor(data)], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const processedPath = moveWithMetadata(requestPath, processedDir, {
      status: 'processed',
      issueUrl,
      processedAt: new Date().toISOString(),
      sourceCommit: process.env.AFTER_SHA || git(['rev-parse', 'HEAD']),
    });
    console.log(`Created ${issueUrl} from ${requestPath}; moved request to ${processedPath}`);
  } finally {
    if (existsSync(bodyPath)) rmSync(bodyPath);
  }
}

function failRequest(requestPath, error) {
  const failedPath = moveWithMetadata(requestPath, failedDir, {
    status: 'failed',
    failedAt: new Date().toISOString(),
    sourceCommit: process.env.AFTER_SHA || git(['rev-parse', 'HEAD']),
    error: error.message,
  });
  console.error(`Failed to process ${requestPath}; moved request to ${failedPath}: ${error.message}`);
}

const paths = requestPaths();
if (paths.length === 0) {
  console.log('No newly added pending feature request JSON files found.');
  process.exit(0);
}

let failures = 0;
for (const path of paths) {
  try {
    createIssue(path);
  } catch (error) {
    failures += 1;
    failRequest(path, error);
  }
}

if (failures > 0) process.exit(1);
