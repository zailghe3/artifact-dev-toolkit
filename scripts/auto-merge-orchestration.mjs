export function decidePullRequestAction({ pulls, validatedSha, repository, repositoryOwner }) {
  const matches = pulls.filter((pr) => pr.base?.ref === 'main');
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one associated main pull request for ${validatedSha}, found ${matches.length}`);
  }

  const pr = matches[0];
  const result = { number: pr.number, action: 'noop', reason: '' };
  if (pr.merged || pr.merged_at) return { ...result, reason: 'pull request is already merged' };
  if (pr.state === 'closed') return { ...result, reason: 'pull request was closed without merge' };
  if (pr.state !== 'open') throw new Error(`Pull request #${pr.number} has unsupported state '${pr.state}'.`);
  if (pr.head?.sha !== validatedSha) return { ...result, reason: 'validated workflow run is stale' };
  if (pr.draft) return { ...result, reason: 'pull request is a draft' };
  if (pr.user?.login !== repositoryOwner) return { ...result, reason: 'pull request author is not the repository owner' };
  if (pr.head?.repo?.full_name !== repository) return { ...result, reason: 'pull request branch is not from this repository' };
  return { ...result, action: 'evaluate', reason: 'pull request is current and trusted' };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { readFileSync } = await import('node:fs');
  const pulls = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const result = decidePullRequestAction({
    pulls,
    validatedSha: process.env.VALIDATED_SHA,
    repository: process.env.REPOSITORY,
    repositoryOwner: process.env.REPOSITORY_OWNER,
  });
  for (const [key, value] of Object.entries(result)) console.log(`${key}=${value}`);
}
