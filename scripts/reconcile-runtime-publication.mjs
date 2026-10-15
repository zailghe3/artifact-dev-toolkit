#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRuntimeImagePath } from '../lib/deployment-component-impact.js';
import { classifyGitRange, evaluateOperationFreshness } from './evaluate-deployment-freshness.mjs';
import { parseRelease } from './validate-runtime-revision.mjs';

const shaPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const image = 'poulti/adt-runtime';
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();

export function resolveRuntimeSource(target, run = git) {
  if (!shaPattern.test(target)) throw new Error('Invalid immutable Runtime target');
  for (const revision of run(['rev-list', '--first-parent', target]).split('\n')) {
    const parent = run(['rev-list', '--parents', '-n', '1', revision]).split(' ')[1];
    const paths = parent ? run(['diff', '--name-only', parent, revision])
      : run(['ls-tree', '-r', '--name-only', revision]);
    if (paths.split('\n').some(isRuntimeImagePath)) return revision;
  }
  throw new Error('No trusted Runtime source found');
}

export function publicationPlan({ source, release, sha, revision, latest }) {
  const valid = value => value === null || (value && shaPattern.test(value.source)
    && digestPattern.test(value.digest) && Number.isSafeInteger(value.release) && value.release > 0);
  if (!shaPattern.test(source) || !Number.isSafeInteger(release) || release < 1
    || ![sha, revision, latest].every(valid)) throw new Error('Invalid or unobserved publication state');
  if (Boolean(sha) !== Boolean(revision)) throw new Error('Partial immutable publication; operator reconciliation required');
  for (const state of [sha, revision]) if (state && (state.source !== source || state.release !== release)) {
    throw new Error('Immutable tag conflicts with trusted Runtime source');
  }
  if (sha && sha.digest !== revision.digest) throw new Error('Immutable tag digests disagree');
  if (latest?.release === release && (latest.source !== source || (sha && latest.digest !== sha.digest))) {
    throw new Error('latest contradicts current immutable release');
  }
  if (sha) {
    if (!latest || latest.release < release) throw new Error('Partial publication: latest is missing or behind');
    return 'noop'; // Validated current or newer trusted latest must never move backwards.
  }
  if (latest && latest.release >= release) throw new Error('latest exists without matching immutable tags');
  return 'publish';
}

function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export function isMissingManifest(error, reference) {
  // Only Docker's explicit registry MANIFEST_UNKNOWN response establishes absence.
  const message = String(error.stderr || '').trim();
  return message === `Error response from daemon: manifest for ${reference} not found: manifest unknown: manifest unknown`;
}
function inspect(tag, currentMain) {
  const reference = `${image}:${tag}`;
  try { docker(['pull', reference]); }
  catch (error) {
    if (isMissingManifest(error, reference)) return null;
    throw new Error(`Cannot inspect Runtime tag ${tag}; registry error is not absence`);
  }
  const data = JSON.parse(docker(['image', 'inspect', reference]));
  const digests = [...new Set(data[0].RepoDigests.filter(value => value.startsWith(`${image}@`)).map(value => value.split('@')[1]))];
  if (digests.length !== 1 || !digestPattern.test(digests[0])) throw new Error('Ambiguous registry digest');
  const directory = mkdtempSync(join(tmpdir(), 'adt-runtime-publication-'));
  let container;
  try {
    // Read build-owned metadata without executing registry image code.
    container = docker(['create', `${image}@${digests[0]}`]);
    docker(['cp', `${container}:/runtime/REVISION`, join(directory, 'REVISION')]);
    docker(['cp', `${container}:/runtime/release.json`, join(directory, 'release.json')]);
    const source = readFileSync(join(directory, 'REVISION'), 'utf8').trim();
    const releaseText = readFileSync(join(directory, 'release.json'), 'utf8');
    const manifest = parseRelease(releaseText);
    if (!shaPattern.test(source)) throw new Error('Invalid image source');
    git(['merge-base', '--is-ancestor', source, currentMain]);
    if (resolveRuntimeSource(source) !== source
      || JSON.stringify(parseRelease(git(['show', `${source}:adt-runtime/release.json`]))) !== JSON.stringify(manifest)) {
      throw new Error('Registry image metadata contradicts trusted main source');
    }
    return { source, release: manifest.releaseRevision, digest: digests[0] };
  } finally {
    if (container) docker(['rm', container]);
    rmSync(directory, { recursive: true, force: true });
  }
}

export function reconcile({ source, release, observe, push, refresh }) {
  const read = () => {
    const state = { source, release, sha: observe(source), revision: observe(`r${release}`), latest: observe('latest') };
    if (state.latest && state.latest.release !== release) {
      // A different latest is trusted only when its own immutable pair agrees.
      publicationPlan({ source: state.latest.source, release: state.latest.release,
        sha: observe(state.latest.source), revision: observe(`r${state.latest.release}`), latest: state.latest });
    }
    return state;
  };
  refresh();
  const state = read(), action = publicationPlan(state);
  if (action === 'noop') return action;
  // All trusted publishers share a repository-wide lock. Recheck freshness and
  // all three remote tags immediately before the first irreversible mutation.
  refresh();
  if (publicationPlan(read()) !== 'publish') throw new Error('Publication changed during verification');
  push(source); push(`r${release}`); push('latest');
  const completed = read();
  if (publicationPlan(completed) !== 'noop' || completed.latest.digest !== completed.sha.digest) {
    throw new Error('Published tags did not converge to one verified digest');
  }
  return 'published';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const target = process.env.TARGET_SHA;
    const source = resolveRuntimeSource(target);
    if (process.argv[2] === 'source') {
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${source}\n`);
      else console.log(source);
    } else {
      const release = parseRelease(git(['show', `${source}:adt-runtime/release.json`])).releaseRevision;
      const refresh = () => {
        git(['fetch', '--no-tags', 'origin', 'main']);
        const current = git(['rev-parse', 'origin/main']);
        git(['merge-base', '--is-ancestor', target, current]);
        if (resolveRuntimeSource(current) !== source || !evaluateOperationFreshness({
          operation: 'runtime', interveningImpact: classifyGitRange({ baseRef: target, headRef: current }),
        }).current) throw new Error('A newer or unclassified input supersedes this publication');
      };
      const result = reconcile({ source, release, refresh,
        observe: tag => inspect(tag, git(['rev-parse', 'origin/main'])),
        push: tag => { docker(['tag', 'adt-runtime:verified', `${image}:${tag}`]); docker(['push', `${image}:${tag}`]); },
      });
      console.log(`Runtime r${release}: ${result}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
