#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pendingDir = 'requests/features/pending';
const processedDir = 'requests/features/processed';

export function requestIdFromPath(path) {
  return basename(path, '.json');
}

export function processingBranchName(requestId) {
  return `automation/process-feature-${requestId}`;
}

export function processingPrTitle(request) {
  return `Record processed feature request ${request.featureId || request.requestId}`;
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function gh(args) {
  return execFileSync('gh', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function changedProcessedRequests() {
  const lines = git(['status', '--porcelain', '--', 'requests/features']).split('\n').filter(Boolean);
  const changed = new Map();
  for (const line of lines) {
    const status = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (path.startsWith(`${processedDir}/`) && path.endsWith('.json') && existsSync(resolve(repoRoot, path))) {
      const requestId = requestIdFromPath(path);
      changed.set(requestId, {
        requestId,
        processedPath: path,
        pendingPath: `${pendingDir}/${requestId}.json`,
        processedContent: readFileSync(resolve(repoRoot, path), 'utf8'),
      });
    }
    if (path.startsWith(`${pendingDir}/`) && path.endsWith('.json') && status.includes('D')) {
      const requestId = requestIdFromPath(path);
      changed.set(requestId, changed.get(requestId) ?? {
        requestId,
        processedPath: `${processedDir}/${requestId}.json`,
        pendingPath: path,
      });
    }
  }
  return [...changed.values()].filter((request) => request.processedContent);
}

function existingOpenPr(branch) {
  const output = gh(['pr', 'list', '--state', 'open', '--head', branch, '--json', 'number,url', '--limit', '1']);
  const prs = JSON.parse(output || '[]');
  return prs[0];
}

function createOrUpdateProcessingPr(request, baseRef) {
  const branch = processingBranchName(request.requestId);
  const metadata = JSON.parse(request.processedContent);
  const title = processingPrTitle({ requestId: request.requestId, featureId: metadata.featureId ?? metadata['feature-id'] });
  const marker = [
    `request-id: ${request.requestId}`,
    `feature-id: ${metadata.featureId ?? metadata['feature-id'] ?? 'unknown'}`,
    `issue-number: ${metadata.processing?.issueNumber ?? 'unknown'}`,
    `issue-url: ${metadata.processing?.issueUrl ?? 'unknown'}`,
  ].join('\n');
  const body = `Records the processed lifecycle state for feature request ${request.requestId}.\n\n${marker}\n\nThis PR is intentionally opened by automation instead of pushing directly to main so repository rules, CI, and auto-merge can complete the change.`;

  git(['fetch', 'origin', 'main']);
  git(['checkout', '-B', branch, baseRef]);
  rmSync(resolve(repoRoot, request.pendingPath), { force: true });
  mkdirSync(resolve(repoRoot, dirname(request.processedPath)), { recursive: true });
  writeFileSync(resolve(repoRoot, request.processedPath), request.processedContent);
  git(['add', request.pendingPath, request.processedPath]);

  try {
    git(['diff', '--cached', '--quiet', '--', request.pendingPath, request.processedPath]);
    console.log(`No lifecycle changes remain for ${request.requestId}; processed state is already merged.`);
    return;
  } catch {
    git(['commit', '-m', title]);
  }

  git(['push', '--force-with-lease', 'origin', `${branch}:${branch}`]);
  const existing = existingOpenPr(branch);
  if (existing) {
    console.log(`Reused existing processing PR ${existing.url} for ${request.requestId}.`);
    return;
  }
  const url = gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', body]);
  console.log(`Opened processing PR ${url} for ${request.requestId}.`);
}

function main() {
  const requests = changedProcessedRequests();
  if (requests.length === 0) {
    console.log('No requests/features lifecycle changes to open as processing PRs.');
    return;
  }
  git(['config', 'user.name', 'github-actions[bot]']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  const baseRef = process.env.GITHUB_SHA || 'origin/main';
  for (const request of requests) createOrUpdateProcessingPr(request, baseRef);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
