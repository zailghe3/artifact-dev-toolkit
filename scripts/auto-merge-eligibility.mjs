const exactSensitivePaths = new Set([
  'package.json',
  'package-lock.json',
  'wrangler.jsonc',
]);

function normalizePath(path) {
  return String(path ?? '').replace(/^\.\//, '');
}

export function isSensitivePath(path) {
  const normalized = normalizePath(path);

  return (
    normalized.startsWith('.github/workflows/') ||
    normalized.startsWith('.github/actions/') ||
    normalized.startsWith('scripts/') ||
    exactSensitivePaths.has(normalized) ||
    /^open-next\.config\..+$/.test(normalized)
  );
}

export function getSensitiveChangedFiles(files) {
  return files.flatMap((file) => {
    const paths = [file.filename, file.previous_filename].filter(Boolean);
    return paths
      .filter(isSensitivePath)
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

  const sensitiveFiles = getSensitiveChangedFiles(files);
  if (sensitiveFiles.length > 0) {
    const changedPaths = [...new Set(sensitiveFiles.map((file) => file.path))].join(', ');
    return {
      eligible: false,
      reason: `pull request changes sensitive file(s) requiring manual review: ${changedPaths}`,
    };
  }

  return {
    eligible: true,
    reason: 'trusted same-repository pull request contains no sensitive file changes',
  };
}
