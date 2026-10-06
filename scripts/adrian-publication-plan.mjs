#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

const shaPattern = /^[0-9a-f]{40}$/;
const runNumberPattern = /^[1-9][0-9]*$/;

export function resolveAdrianPublicationPlan({ callMode, targetSha, upstreamSha, runId, runAttempt }) {
  if (!shaPattern.test(targetSha) || !shaPattern.test(upstreamSha)) {
    throw new Error('Adrian publication requires full lowercase target and upstream commit SHAs.');
  }
  if (callMode === 'source') {
    return { mode: 'source', immutableTag: targetSha, upstreamTag: `upstream-${upstreamSha}` };
  }
  if (callMode === '') {
    if (!runNumberPattern.test(runId) || !runNumberPattern.test(runAttempt)) {
      throw new Error('Direct Adrian rebuild requires numeric run identity.');
    }
    return { mode: 'rebuild', immutableTag: `rebuild-${runId}-${runAttempt}`, upstreamTag: '' };
  }
  throw new Error(`Unsupported Adrian publication call mode '${callMode}'.`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const plan = resolveAdrianPublicationPlan({
    callMode: process.env.ADRIAN_PUBLICATION_CALL_MODE ?? '',
    targetSha: process.env.TARGET_SHA ?? '',
    upstreamSha: process.env.UPSTREAM_SHA ?? '',
    runId: process.env.GITHUB_RUN_ID ?? '',
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? '',
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.');
  for (const [key, value] of Object.entries({
    mode: plan.mode,
    immutable_tag: plan.immutableTag,
    upstream_tag: plan.upstreamTag,
  })) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
