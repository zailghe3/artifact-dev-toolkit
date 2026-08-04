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

export function proposalErrorMessage(code: unknown) {
  const messages: Record<string, string> = {
    validation_failed: "Check the proposed metadata and body, then try again.", secret_rejected: "Remove secret-like content before proposing this change.",
    artifact_too_large: "The proposed artifact is too large.", proposal_permission_required: "The GitHub App needs Contents and Pull requests write permission.",
    write_conflict: "This artifact changed. Reload before proposing your update.", proposal_branch_collision: "A different proposal already uses this artifact revision. Review it in GitHub or reload.",
    repository_unavailable: "The artifact repository is temporarily unavailable. Try again later.", proposal_incomplete: "The branch was created, but the pull request could not be completed. Use the recovery link or try the same request again.",
  };
  return typeof code === "string" ? messages[code] ?? unknownEditErrorMessage : unknownEditErrorMessage;
}

export function hasPreview(value: unknown): value is { metadata: { title: string; status: string; sourceId?: string; tags: string[]; aliases: string[] }; bodyHtml: string } {
  const candidate = value as { metadata?: Record<string, unknown>; bodyHtml?: unknown } | null;
  return !!candidate && typeof candidate.bodyHtml === "string" && typeof candidate.metadata?.title === "string" && typeof candidate.metadata.status === "string" && Array.isArray(candidate.metadata.tags) && Array.isArray(candidate.metadata.aliases);
}
