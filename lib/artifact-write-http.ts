import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/auth-core";
import {
  ArtifactDuplicateError, ArtifactNotFoundError, ArtifactRepositoryConfigurationError,
  ArtifactRepositoryUnavailableError, ArtifactSecretRejectedError, ArtifactWriteAuthenticationError,
  ArtifactWriteConflictError, ArtifactWritePermissionError, ArtifactWriteValidationError,
} from "@/lib/artifact-repository";

export function artifactWriteErrorResponse(error: unknown) {
  if (error instanceof ArtifactWriteValidationError) return NextResponse.json({ error: "Artifact input is invalid", code: "validation_failed" }, { status: 400, headers: noStoreHeaders });
  if (error instanceof ArtifactSecretRejectedError) return NextResponse.json({ error: "Artifact content failed the secret safety check", code: "secret_rejected" }, { status: 400, headers: noStoreHeaders });
  if (error instanceof ArtifactWriteAuthenticationError) return NextResponse.json({ error: "GitHub repository authentication failed", code: "repository_authentication_failed" }, { status: 401, headers: noStoreHeaders });
  if (error instanceof ArtifactWritePermissionError) return NextResponse.json({ error: "GitHub App write permission is required", code: "write_permission_required" }, { status: 403, headers: noStoreHeaders });
  if (error instanceof ArtifactNotFoundError) return NextResponse.json({ error: "Artifact not found", code: "artifact_not_found" }, { status: 404, headers: noStoreHeaders });
  if (error instanceof ArtifactDuplicateError) return NextResponse.json({ error: "Artifact ID or path already exists", code: "duplicate_artifact" }, { status: 409, headers: noStoreHeaders });
  if (error instanceof ArtifactWriteConflictError) return NextResponse.json({ error: "Artifact changed since it was loaded", code: "write_conflict" }, { status: 409, headers: noStoreHeaders });
  if (error instanceof ArtifactRepositoryUnavailableError) return NextResponse.json({ error: "Artifact repository temporarily unavailable", code: "repository_unavailable" }, { status: 503, headers: noStoreHeaders });
  if (error instanceof ArtifactRepositoryConfigurationError) return NextResponse.json({ error: "Artifact repository is not configured for writes", code: "repository_configuration" }, { status: 500, headers: noStoreHeaders });
  return NextResponse.json({ error: "Artifact could not be written", code: "internal_error" }, { status: 500, headers: noStoreHeaders });
}
