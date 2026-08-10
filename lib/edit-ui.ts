export const unknownEditErrorMessage = "Something went wrong. Please try again.";

export function safeGitHubUrl(value: unknown, kind: "commit" | "pull" | "branch") {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return undefined;
    const pattern = kind === "commit" ? /^\/[^/]+\/[^/]+\/commit\/[A-Za-z0-9]+$/ : kind === "pull" ? /^\/[^/]+\/[^/]+\/pull\/\d+$/ : /^\/[^/]+\/[^/]+\/tree\/artifact-(?:change|delete)\/[^/]+$/;
    return pattern.test(url.pathname) && !url.search && !url.hash ? url.href : undefined;
  } catch { return undefined; }
}

export function safeArtifactHref(value: unknown) { return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? `/artifacts/${encodeURIComponent(value)}` : undefined; }
export function lifecycleErrorMessage(code: unknown) {
  const messages: Record<string, string> = { validation_failed: "Check the artifact metadata and Markdown, then try again.", secret_rejected: "Remove secret-like content before saving.", artifact_too_large: "The artifact is too large.", write_conflict: "This artifact changed. Reload before trying again.", production_update_requires_proposal: "Production updates require a reviewable proposal.", production_delete_requires_proposal: "Production deletion requires a reviewable proposal.", proposal_requires_production_artifact: "Only production artifacts use the deletion proposal workflow.", proposal_branch_collision: "A different change already uses this proposal branch.", repository_authentication_failed: "Repository authentication failed. Sign in again or contact an administrator.", repository_configuration: "The artifact repository is not configured for this operation.", write_permission_required: "The GitHub App needs Contents write permission.", proposal_permission_required: "The GitHub App needs proposal permission.", repository_unavailable: "The repository is temporarily unavailable.", proposal_incomplete: "The branch was created, but its pull request could not be completed.", duplicate_artifact: "An artifact with this ID or path already exists.", artifact_not_found: "The artifact no longer exists.", artifact_in_use: "This prompt is referenced by Agents. Remove or replace those references first." };
  return typeof code === "string" ? messages[code] ?? unknownEditErrorMessage : unknownEditErrorMessage;
}

export function proposalErrorMessage(code: unknown) {
  const messages: Record<string, string> = {
    validation_failed: "Check the proposed metadata and body, then try again.", secret_rejected: "Remove secret-like content before proposing this change.",
    artifact_too_large: "The proposed artifact is too large.", proposal_permission_required: "The GitHub App needs Contents and Pull requests write permission.",
    write_conflict: "This artifact changed. Reload before proposing your update.", proposal_branch_collision: "A different proposal already uses this artifact revision. Review it in GitHub or reload.",
    repository_unavailable: "The artifact repository is temporarily unavailable. Try again later.", proposal_incomplete: "The branch was created, but the pull request could not be completed. Use the recovery link or try the same request again.",
  };
  return typeof code === "string" ? messages[code] ?? unknownEditErrorMessage : unknownEditErrorMessage;
}

export function hasPreview(value: unknown): value is { metadata: { id: string; title: string; description?:string; type: string; status: string; sourceId?: string; createdAt?: string; tags: string[]; aliases: string[] }; bodyHtml: string } {
  const candidate = value as { metadata?: Record<string, unknown>; bodyHtml?: unknown } | null;
  return !!candidate && typeof candidate.bodyHtml === "string" && typeof candidate.metadata?.id === "string" && typeof candidate.metadata.title === "string" && (candidate.metadata.description === undefined || typeof candidate.metadata.description === "string") && typeof candidate.metadata.type === "string" && typeof candidate.metadata.status === "string" && (candidate.metadata.sourceId === undefined || typeof candidate.metadata.sourceId === "string") && (candidate.metadata.createdAt === undefined || typeof candidate.metadata.createdAt === "string") && Array.isArray(candidate.metadata.tags) && candidate.metadata.tags.every((value) => typeof value === "string") && Array.isArray(candidate.metadata.aliases) && candidate.metadata.aliases.every((value) => typeof value === "string");
}
