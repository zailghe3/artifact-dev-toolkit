import { normalizePath, requiresManualReviewPath } from './change-policy.mjs';

export function getManualReviewChangedFiles(files) {
  return files.flatMap((file) => {
    const paths = [file.filename, file.previous_filename].filter(Boolean);
    return paths
      .filter(requiresManualReviewPath)
      .map((path) => ({ path: normalizePath(path), status: file.status }));
  });
}

export function evaluateAutoMergeEligibility({ author, repositoryOwner, repository, headRepository, files }) {
  if (author !== repositoryOwner) {
    return {
      eligible: false,
      reason: `pull request author '${author}' is not the repository owner '${repositoryOwner}'`,
    };
  }

  if (headRepository !== repository) {
    return {
      eligible: false,
      reason: 'pull request branch is from a fork or different repository',
    };
  }

  const changedPaths = files.flatMap((file) => [file.filename, file.previous_filename]).filter(Boolean);
  if (changedPaths.length === 0) {
    return {
      eligible: false,
      reason: 'pull request has no changed paths to evaluate',
    };
  }

  const manualReviewFiles = getManualReviewChangedFiles(files);
  if (manualReviewFiles.length > 0) {
    const paths = [...new Set(manualReviewFiles.map((file) => file.path))].join(', ');
    return {
      eligible: false,
      reason: `pull request changes file(s) outside the low-sensitivity auto-merge allowlist: ${paths}`,
    };
  }

  return {
    eligible: true,
    reason: 'trusted same-repository pull request contains only low-sensitivity allowlisted changes',
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { readFileSync } = await import('node:fs');
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/auto-merge-eligibility.mjs files.jsonl');
  const files = readFileSync(input, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const result = evaluateAutoMergeEligibility({
    author: process.env.PR_AUTHOR,
    repositoryOwner: process.env.REPOSITORY_OWNER,
    repository: process.env.REPOSITORY,
    headRepository: process.env.HEAD_REPOSITORY,
    files,
  });
  console.log(`eligible=${result.eligible}`);
  console.log(`reason=${result.reason}`);
}
