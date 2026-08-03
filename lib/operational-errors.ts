import {
  ArtifactProposalPermissionError, ArtifactRepositoryAccessError, ArtifactRepositoryConfigurationError,
  ArtifactRepositoryContentError, ArtifactRepositoryUnavailableError, ArtifactWritePermissionError, ArtifactRepositoryNotFoundError, ArtifactBranchNotFoundError,
} from "./artifact-repository.ts";
import { CatalogueCacheUnavailableError, CatalogueSnapshotCorruptError } from "./artifact-catalogue.ts";

export type OperationalCategory = "authentication_required" | "repository_authorization_denied" | "github_app_not_installed" | "repository_configuration_invalid" | "repository_not_found" | "branch_not_found" | "repository_read_permission_required" | "repository_write_permission_required" | "proposal_permission_required" | "github_rate_limited" | "github_temporarily_unavailable" | "artifact_repository_invalid" | "catalogue_cache_unavailable" | "catalogue_cache_corrupt" | "unexpected_error";
export type OperationalState = { category: OperationalCategory; title: string; explanation: string; guidance: string; retry: boolean; status: number };

const states: Record<OperationalCategory, Omit<OperationalState, "category">> = {
  authentication_required: { title: "Sign-in required", explanation: "Your authenticated session is unavailable or expired.", guidance: "Sign in again to continue.", retry: false, status: 401 },
  repository_authorization_denied: { title: "Repository access denied", explanation: "Your GitHub identity is not authorized for the configured repository.", guidance: "Ask an administrator to grant your account and the GitHub App access.", retry: false, status: 403 },
  github_app_not_installed: { title: "GitHub App access required", explanation: "The GitHub App cannot access this repository.", guidance: "Ask an administrator to install the App or select this repository.", retry: false, status: 403 },
  repository_configuration_invalid: { title: "Repository configuration invalid", explanation: "The configured repository settings could not be used safely.", guidance: "Verify the owner, repository, branch, artifact root, and authentication settings.", retry: false, status: 500 },
  repository_not_found: { title: "Repository not found", explanation: "The configured repository was not found or is not visible to the App.", guidance: "Verify the repository and GitHub App installation.", retry: false, status: 404 },
  branch_not_found: { title: "Branch not found", explanation: "The configured base branch could not be found.", guidance: "Verify the configured branch name.", retry: false, status: 404 },
  repository_read_permission_required: { title: "Contents read permission required", explanation: "The GitHub App cannot read repository contents.", guidance: "Grant the GitHub App Contents read permission.", retry: false, status: 403 },
  repository_write_permission_required: { title: "Contents write permission required", explanation: "The GitHub App cannot write repository contents.", guidance: "Grant the GitHub App Contents write permission.", retry: false, status: 403 },
  proposal_permission_required: { title: "Pull request permission required", explanation: "The GitHub App cannot create proposals.", guidance: "Grant Contents write and Pull requests write permissions.", retry: false, status: 403 },
  github_rate_limited: { title: "GitHub rate limit reached", explanation: "GitHub temporarily limited repository requests.", guidance: "Wait and retry later.", retry: true, status: 503 },
  github_temporarily_unavailable: { title: "GitHub temporarily unavailable", explanation: "Repository data could not be retrieved right now.", guidance: "Retry after the temporary GitHub interruption.", retry: true, status: 503 },
  artifact_repository_invalid: { title: "Repository artifacts are invalid", explanation: "One or more repository files do not satisfy the artifact contract.", guidance: "Use diagnostics to identify and correct invalid files, then run the manual catalogue refresh.", retry: false, status: 422 },
  catalogue_cache_unavailable: { title: "Catalogue cache unavailable", explanation: "Workers KV could not be read safely.", guidance: "Retry later; use diagnostics to inspect cache and repository state.", retry: true, status: 503 },
  catalogue_cache_corrupt: { title: "Catalogue cache invalid", explanation: "The published catalogue snapshot did not validate.", guidance: "Run the existing manual refresh after verifying repository content.", retry: false, status: 500 },
  unexpected_error: { title: "Unexpected error", explanation: "The application encountered an unexpected problem.", guidance: "Retry later or contact an administrator.", retry: true, status: 500 },
};

export function operationalState(category: OperationalCategory): OperationalState { return { category, ...states[category] }; }
export function mapOperationalError(error: unknown): OperationalState {
  if (error instanceof CatalogueCacheUnavailableError) return operationalState("catalogue_cache_unavailable");
  if (error instanceof CatalogueSnapshotCorruptError) return operationalState("catalogue_cache_corrupt");
  if (error instanceof ArtifactBranchNotFoundError) return operationalState("branch_not_found");
  if (error instanceof ArtifactRepositoryNotFoundError) return operationalState("repository_not_found");
  if (error instanceof ArtifactRepositoryUnavailableError) return operationalState(error.status === 429 ? "github_rate_limited" : "github_temporarily_unavailable");
  if (error instanceof ArtifactRepositoryAccessError) return operationalState("repository_read_permission_required");
  if (error instanceof ArtifactRepositoryConfigurationError) return operationalState("repository_configuration_invalid");
  if (error instanceof ArtifactRepositoryContentError) return operationalState("artifact_repository_invalid");
  if (error instanceof ArtifactWritePermissionError) return operationalState("repository_write_permission_required");
  if (error instanceof ArtifactProposalPermissionError) return operationalState("proposal_permission_required");
  return operationalState("unexpected_error");
}
export function isExpectedOperationalError(error: unknown) { return mapOperationalError(error).category !== "unexpected_error"; }
