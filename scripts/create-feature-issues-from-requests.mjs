#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFeatureIssue } from './render-feature-issue.mjs';
import { validateFeatureRequestData } from './feature-request-validation.mjs';

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

function requestIdFromPath(path) {
  return basename(path, '.json');
}

function issueMarker(requestId) {
  return `<!-- feature-request:request-id=${requestId} -->`;
}

function issueNumberFromUrl(issueUrl) {
  const match = String(issueUrl).match(/\/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function issueTitle(data) {
  const featureId = String(data.featureId ?? data['feature-id'] ?? '').trim();
  const explicitTitle = String(data.title ?? '').trim();
  if (explicitTitle) return featureId ? `[${featureId}]: ${explicitTitle}` : explicitTitle;

  const objective = String(data.objective ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? 'Feature request';
  const compactObjective = objective.length > 90 ? `${objective.slice(0, 87).trimEnd()}...` : objective;
  return featureId ? `[${featureId}]: ${compactObjective}` : compactObjective;
}

const managedLabels = new Map([
  ['type:feature', { color: '0e8a16', description: 'Feature request' }],
  ['status:ready-for-codex', { color: 'fbca04', description: 'Ready for Codex implementation' }],
]);

function labelNamesFor(data) {
  const configured = Array.isArray(data.labels) ? data.labels : [...managedLabels.keys()];
  return configured.map((label) => String(label));
}

function labelsFor(data) {
  return labelNamesFor(data).flatMap((label) => ['--label', label]);
}

function ensureManagedLabels(labels) {
  for (const label of labels) {
    const definition = managedLabels.get(label);
    if (!definition) continue;

    try {
      execFileSync('gh', [
        'label',
        'create',
        label,
        '--color',
        definition.color,
        '--description',
        definition.description,
      ], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log(`Created missing GitHub label ${label}.`);
    } catch (error) {
      const stderr = String(error.stderr ?? '');
      if (/already exists/i.test(stderr)) {
        console.log(`GitHub label ${label} already exists.`);
        continue;
      }
      throw error;
    }
  }
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

function findExistingIssue(requestId) {
  const search = `${issueMarker(requestId)} in:body`;
  try {
    const output = execFileSync('gh', ['issue', 'list', '--state', 'all', '--search', search, '--json', 'number,url', '--limit', '1'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(output || '[]')[0];
  } catch (error) {
    throw new Error(`Unable to search for existing issue for ${requestId}: ${error.message}`);
  }
}

function createIssue(requestPath) {
  const absolutePath = resolve(repoRoot, requestPath);
  const data = JSON.parse(readFileSync(absolutePath, 'utf8'));
  const requestId = requestIdFromPath(requestPath);
  const processedPath = `${processedDir}/${basename(requestPath)}`;
  if (existsSync(resolve(repoRoot, processedPath))) {
    console.log(`Skipping ${requestPath}; ${processedPath} already exists.`);
    return;
  }
  validateFeatureRequestData(data);
  const labels = labelNamesFor(data);
  ensureManagedLabels(labels);
  const body = `${issueMarker(requestId)}\n\n${renderFeatureIssue(data)}`;
  const bodyPath = resolve(repoRoot, `.feature-issue-body-${timestamp()}.md`);
  writeFileSync(bodyPath, body);

  try {
    const existingIssue = findExistingIssue(requestId);
    const issueUrl = existingIssue?.url ?? execFileSync('gh', ['issue', 'create', '--title', issueTitle(data), '--body-file', bodyPath, ...labels.flatMap((label) => ['--label', label])], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const issueNumber = existingIssue?.number ?? issueNumberFromUrl(issueUrl);

    const processedPath = moveWithMetadata(requestPath, processedDir, {
      status: 'created',
      requestId,
      featureId: data.featureId ?? data['feature-id'],
      issueNumber,
      issueUrl,
      processedAt: new Date().toISOString(),
      sourceCommit: process.env.AFTER_SHA || git(['rev-parse', 'HEAD']),
    });
    const action = existingIssue ? 'Reused existing issue' : 'Created';
    console.log(`${action} ${issueUrl} from ${requestPath}; moved request to ${processedPath}`);
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
