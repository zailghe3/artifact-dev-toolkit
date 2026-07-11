#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFeatureIssue } from './render-feature-issue.mjs';
import { validateFeatureRequestData } from './feature-request-validation.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const featureRequestDir = 'requests/features';
export const featureRequestPattern = /^requests\/features\/[^/]+\.json$/;

export function requestIdFromDataOrPath(data, path) {
  const requestId = String(data.requestId ?? '').trim();
  return requestId || basename(path, '.json');
}

export function issueMarker(requestId) {
  return `<!-- feature-request-id: ${requestId} -->`;
}

export function issueTitle(data) {
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

export function labelNamesFor(data) {
  const configured = Array.isArray(data.labels) ? data.labels : [...managedLabels.keys()];
  return configured.map((label) => String(label));
}

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

export function allFeatureRequests({ gitExec = git } = {}) {
  return gitExec(['ls-files', `${featureRequestDir}/*.json`]).split('\n').filter(Boolean).filter((path) => featureRequestPattern.test(path));
}

export function changedFeatureRequestsFromEnv({ gitExec = git, env = process.env } = {}) {
  if (env.FEATURE_REQUEST_FILES) {
    return env.FEATURE_REQUEST_FILES.split(/\r?\n/).map((path) => path.trim()).filter(Boolean).filter((path) => featureRequestPattern.test(path));
  }
  const before = env.BEFORE_SHA;
  const after = env.AFTER_SHA || 'HEAD';
  if (!before || /^0+$/.test(before)) {
    return gitExec(['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=AM', '-r', after, '--', `${featureRequestDir}/*.json`])
      .split('\n').filter(Boolean).filter((path) => featureRequestPattern.test(path));
  }
  return gitExec(['diff', '--name-only', '--diff-filter=AM', before, after, '--', `${featureRequestDir}/*.json`])
    .split('\n').filter(Boolean).filter((path) => featureRequestPattern.test(path));
}

export function requestPaths({ env = process.env, gitExec = git } = {}) {
  const mode = env.FEATURE_REQUEST_MODE || 'changed';
  const paths = mode === 'all' ? allFeatureRequests({ gitExec }) : changedFeatureRequestsFromEnv({ gitExec, env });
  return [...new Set(paths)].filter((path) => featureRequestPattern.test(path));
}

function gh(args) {
  return execFileSync('gh', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function ensureManagedLabels(labels) {
  for (const label of labels) {
    const definition = managedLabels.get(label);
    if (!definition) continue;
    try {
      gh(['label', 'create', label, '--color', definition.color, '--description', definition.description]);
      console.log(`Created missing GitHub label ${label}.`);
    } catch (error) {
      if (/already exists/i.test(String(error.stderr ?? ''))) continue;
      throw error;
    }
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function findExistingIssue(requestId, { ghExec = gh } = {}) {
  const search = `${issueMarker(requestId)} in:body`;
  const output = ghExec(['issue', 'list', '--state', 'all', '--search', search, '--json', 'number,url', '--limit', '1']);
  return JSON.parse(output || '[]')[0];
}

export function issueNumberFromUrl(issueUrl) {
  const match = String(issueUrl).match(/\/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

export function loadAndRenderRequest(requestPath) {
  const data = JSON.parse(readFileSync(resolve(repoRoot, requestPath), 'utf8'));
  const requestId = requestIdFromDataOrPath(data, requestPath);
  if (!data.requestId || String(data.requestId).trim() !== basename(requestPath, '.json')) {
    throw new Error(`${requestPath} must contain a requestId matching its canonical file name.`);
  }
  validateFeatureRequestData(data);
  return { data, requestId, body: `${issueMarker(requestId)}\n\n${renderFeatureIssue(data)}` };
}

export function createIssue(requestPath) {
  const { data, requestId, body } = loadAndRenderRequest(requestPath);
  const existingIssue = findExistingIssue(requestId);
  if (existingIssue) {
    console.log(`Skipped ${requestPath}; marker already exists in ${existingIssue.url}.`);
    return { path: requestPath, status: 'skipped', issue: existingIssue };
  }
  const labels = labelNamesFor(data);
  ensureManagedLabels(labels);
  const bodyPath = resolve(repoRoot, `.feature-issue-body-${timestamp()}.md`);
  writeFileSync(bodyPath, body);
  try {
    const issueUrl = gh(['issue', 'create', '--title', issueTitle(data), '--body-file', bodyPath, ...labels.flatMap((label) => ['--label', label])]);
    const issue = { url: issueUrl, number: issueNumberFromUrl(issueUrl) };
    console.log(`Created ${issueUrl} from ${requestPath}.`);
    return { path: requestPath, status: 'created', issue };
  } finally {
    if (existsSync(bodyPath)) rmSync(bodyPath);
  }
}

function main() {
  const paths = requestPaths();
  if (paths.length === 0) {
    console.log('No changed feature request JSON files found.');
    return;
  }
  let failures = 0;
  for (const path of paths) {
    try {
      createIssue(path);
    } catch (error) {
      failures += 1;
      console.error(`Failed to process ${path}: ${error.message}`);
    }
  }
  if (failures > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
