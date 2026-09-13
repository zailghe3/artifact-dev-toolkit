#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { classifyChanges } from './classify-changes.mjs';

export function parseGitNameStatus(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split('\t');
      const code = parts[0];
      if (code.startsWith('R') || code.startsWith('C')) {
        return { status: 'renamed', previous_filename: parts[1], filename: parts[2] };
      }
      return {
        status: code === 'A' ? 'added' : code === 'D' ? 'removed' : 'modified',
        filename: parts[1],
      };
    });
}

export function classifyGitRange({ baseRef, headRef, git = execFileSync }) {
  const diff = git('git', ['diff', '--name-status', '-M', baseRef, headRef], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return classifyChanges(parseGitNameStatus(diff));
}

export function evaluateOperationFreshness({
  operation,
  interveningImpact,
  targetDeployWorker = false,
  targetApplyMigrations = false,
  targetRunnerReleaseBarrier = false,
}) {
  if (interveningImpact.has_unclassified_changes) {
    return { current: false, reason: 'intervening range contains unclassified paths' };
  }

  if (operation === 'runtime') {
    return interveningImpact.publish_runtime
      ? { current: false, reason: 'a newer Runtime image input exists' }
      : { current: true, reason: 'intervening commits do not change Runtime image inputs' };
  }

  if (operation === 'runner') {
    return interveningImpact.publish_runner
      ? { current: false, reason: 'a newer Runner image input exists' }
      : { current: true, reason: 'intervening commits do not change Runner image inputs' };
  }

  if (operation !== 'cloudflare') {
    throw new Error(`Unsupported freshness operation '${operation}'.`);
  }

  if (!targetDeployWorker && !targetApplyMigrations) {
    throw new Error('Cloudflare freshness requires at least one target operation.');
  }
  if (targetRunnerReleaseBarrier && !targetDeployWorker) {
    throw new Error('Runner release barrier requires a Worker deployment target.');
  }

  if (targetRunnerReleaseBarrier) {
    return interveningImpact.runner_release_barrier
      ? { current: false, reason: 'a newer shared Runner release supersedes this Worker-to-Runner barrier' }
      : { current: true, reason: 'exact Worker deployment remains required to establish the shared Runner release barrier' };
  }

  if (targetDeployWorker) {
    return interveningImpact.deploy_worker
      ? { current: false, reason: 'a newer Worker input supersedes this Worker deployment' }
      : { current: true, reason: 'intervening commits do not supersede this Worker deployment' };
  }

  return interveningImpact.apply_migrations
    ? { current: false, reason: 'a newer migration or Worker operation subsumes this migration-only target' }
    : { current: true, reason: 'intervening commits do not subsume this migration-only target' };
}

function parseBoolean(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

function writeWorkflowOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [operation, baseRef, headRef] = process.argv.slice(2);
  if (!operation || !baseRef || !headRef) {
    throw new Error('Usage: node scripts/evaluate-deployment-freshness.mjs <cloudflare|runtime|runner> <base-ref> <head-ref>');
  }

  const interveningImpact = classifyGitRange({ baseRef, headRef });
  const result = evaluateOperationFreshness({
    operation,
    interveningImpact,
    targetDeployWorker: parseBoolean(process.env.TARGET_DEPLOY_WORKER),
    targetApplyMigrations: parseBoolean(process.env.TARGET_APPLY_MIGRATIONS),
    targetRunnerReleaseBarrier: parseBoolean(process.env.TARGET_RUNNER_RELEASE_BARRIER),
  });

  writeWorkflowOutput('current', result.current);
  writeWorkflowOutput('reason', result.reason);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const label = process.env.FRESHNESS_TARGET_LABEL || `${operation} target ${baseRef}`;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${label}: ${result.current ? 'current' : 'superseded'} — ${result.reason}.\n`);
  }

  console.log(JSON.stringify({ operation, baseRef, headRef, ...result, interveningImpact }, null, 2));
}
