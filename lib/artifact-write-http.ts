import { noStoreHeaders } from "./auth-core.ts";
import {
  ArtifactCompatibilityReadOnlyError, ArtifactDuplicateError, ArtifactNotFoundError, ArtifactRepositoryAccessError, ArtifactRepositoryConfigurationError,
  ArtifactRepositoryUnavailableError, ArtifactSecretRejectedError, ArtifactWriteAuthenticationError,
  ArtifactWriteConflictError, ArtifactWritePermissionError, ArtifactWriteValidationError,
  ArtifactWriteTooLargeError,
  ArtifactProposalCollisionError, ArtifactProposalIncompleteError, ArtifactProposalPermissionError,
  ArtifactProductionUpdateRequiresProposalError, ArtifactProductionDeleteRequiresProposalError,
} from "./artifact-repository.ts";

function json(body: unknown, status: number) { return Response.json(body, { status, headers: noStoreHeaders }); }

export function artifactWriteErrorResponse(error: unknown) {
  if (error instanceof ArtifactProductionUpdateRequiresProposalError) return json({ error: "Production updates require the proposal workflow", code: "production_update_requires_proposal" }, 409);
  if (error instanceof ArtifactProductionDeleteRequiresProposalError) return json({ error: "Production deletion requires the proposal workflow", code: "production_delete_requires_proposal" }, 409);
  if (error instanceof ArtifactProposalPermissionError) return json({ error: "GitHub App proposal permission is required", code: "proposal_permission_required" }, 403);
  if (error instanceof ArtifactProposalCollisionError) return json({ error: "A proposal branch already exists", code: "proposal_branch_collision" }, 409);
  if (error instanceof ArtifactProposalIncompleteError) return json({ error: "The proposal branch exists but the pull request was not completed", code: "proposal_incomplete", branchName: error.branchName, branchUrl: error.branchUrl }, 502);
  if (error instanceof ArtifactWriteTooLargeError) return json({ error: "Artifact exceeds the maximum allowed size", code: "artifact_too_large" }, 413);
  if (error instanceof ArtifactWriteValidationError) return json({ error: "Artifact input is invalid", code: "validation_failed" }, 400);
  if (error instanceof ArtifactSecretRejectedError) return json({ error: "Artifact content failed the secret safety check", code: "secret_rejected" }, 400);
  if (error instanceof ArtifactWriteAuthenticationError || error instanceof ArtifactRepositoryAccessError) return json({ error: "GitHub repository authentication failed", code: "repository_authentication_failed" }, 401);
  if (error instanceof ArtifactWritePermissionError) return json({ error: "GitHub App write permission is required", code: "write_permission_required" }, 403);
  if (error instanceof ArtifactNotFoundError) return json({ error: "Artifact not found", code: "artifact_not_found" }, 404);
  if (error instanceof ArtifactDuplicateError) return json({ error: "Artifact ID or path already exists", code: "duplicate_artifact" }, 409);
  if (error instanceof ArtifactWriteConflictError) return json({ error: "Artifact changed since it was loaded", code: "write_conflict" }, 409);
  if (error instanceof ArtifactRepositoryUnavailableError) return json({ error: "Artifact repository temporarily unavailable", code: "repository_unavailable" }, 503);
  if (error instanceof ArtifactCompatibilityReadOnlyError) return json({ error: error.message, code: "compatibility_content_read_only" }, 409);
  if (error instanceof ArtifactRepositoryConfigurationError) return json({ error: "Artifact repository is not configured for writes", code: "repository_configuration" }, 500);
  return json({ error: "Artifact could not be written", code: "internal_error" }, 500);
}
