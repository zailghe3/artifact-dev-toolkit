import { getArtifactRepositoryBackend } from "./artifact-repository.ts";
import {DEFAULT_ARTIFACT_ROOT} from "./artifact-contract.ts";

export type PublicRepositoryConfiguration = {
  backend: "github" | "file" | "invalid";
  owner?: string;
  repository?: string;
  branch: string;
  root: string;
  identityValid: boolean;
};

function normalized(value: string | undefined) { return value?.trim() || undefined; }

/** Parses only non-secret repository settings, so secret failures cannot bypass identity binding. */
export function getPublicRepositoryConfiguration(): PublicRepositoryConfiguration {
  let backend: PublicRepositoryConfiguration["backend"] = "invalid";
  try { backend = getArtifactRepositoryBackend(); } catch { /* represented as invalid */ }
  const owner = normalized(process.env.GITHUB_ARTIFACT_REPOSITORY_OWNER);
  const repository = normalized(process.env.GITHUB_ARTIFACT_REPOSITORY_NAME);
  const branch = normalized(process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH) ?? "main";
  const root = DEFAULT_ARTIFACT_ROOT;
  return { backend, ...(owner ? { owner } : {}), ...(repository ? { repository } : {}), branch, root, identityValid: backend === "file" || (backend === "github" && Boolean(owner && repository)) };
}

export function storedRepositoryMatchesPublicConfiguration(stored: { owner: string; repo: string }, config = getPublicRepositoryConfiguration()) {
  if (!config.owner || !config.repository) return "unknown" as const;
  return stored.owner.toLowerCase() === config.owner.toLowerCase() && stored.repo.toLowerCase() === config.repository.toLowerCase();
}
