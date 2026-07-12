export type DeploymentMetadata = {
  deployedAt: string;
  commitSha: string;
  pullRequestNumber?: number;
  repository: string;
};

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePullRequestNumber(value: string | undefined): number | undefined {
  const trimmed = nonEmpty(value);
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isValidUtcTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function createDeploymentMetadata(input: {
  deployedAt?: string;
  commitSha?: string;
  pullRequestNumber?: string;
  repository?: string;
}): DeploymentMetadata | null {
  const deployedAt = nonEmpty(input.deployedAt);
  const commitSha = nonEmpty(input.commitSha);
  const repository = nonEmpty(input.repository) ?? "zailghe3/artifact-dev-toolkit";

  if (!deployedAt || !commitSha) {
    return null;
  }

  if (!isValidUtcTimestamp(deployedAt) || !FULL_SHA_PATTERN.test(commitSha)) {
    return null;
  }

  return {
    deployedAt,
    commitSha: commitSha.toLowerCase(),
    pullRequestNumber: parsePullRequestNumber(input.pullRequestNumber),
    repository,
  };
}

export function getDeploymentDisplayModel(metadata: DeploymentMetadata) {
  const shortCommitSha = metadata.commitSha.slice(0, 7);
  const repositoryUrl = `https://github.com/${metadata.repository}`;

  return {
    deployedAt: metadata.deployedAt,
    commitSha: metadata.commitSha,
    shortCommitSha,
    commitUrl: `${repositoryUrl}/commit/${metadata.commitSha}`,
    pullRequestNumber: metadata.pullRequestNumber,
    pullRequestUrl: metadata.pullRequestNumber ? `${repositoryUrl}/pull/${metadata.pullRequestNumber}` : undefined,
  };
}

export const deploymentMetadata = createDeploymentMetadata({
  deployedAt: process.env.NEXT_PUBLIC_DEPLOYED_AT,
  commitSha: process.env.NEXT_PUBLIC_DEPLOY_COMMIT_SHA,
  pullRequestNumber: process.env.NEXT_PUBLIC_DEPLOY_PULL_REQUEST_NUMBER,
  repository: process.env.NEXT_PUBLIC_DEPLOY_REPOSITORY,
});
