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
  const messages: Record<string, string> = { validation_failed: "Check the artifact metadata and Markdown, then try again.", secret_rejected: "Remove secret-like content before saving.", artifact_too_large: "The artifact is too large.", write_conflict: "This artifact changed. Reload before trying again.", repository_authentication_failed: "Repository authentication failed. Sign in again or contact an administrator.", write_permission_required: "The GitHub App needs Contents write permission.", repository_unavailable: "The artifact repository is temporarily unavailable. Try again later.", repository_configuration: "The artifact repository is not configured for this operation.", duplicate_artifact: "An artifact with this ID or path already exists.", artifact_not_found: "The artifact no longer exists.", artifact_in_use: "This prompt is referenced by Agents. Remove or replace those references first." };
  return typeof code === "string" ? messages[code] ?? unknownEditErrorMessage : unknownEditErrorMessage;
}


export function hasPreview(value: unknown): value is { metadata: { id: string; title: string; description?:string; type: string; sourceId?: string; createdAt?: string; tags: string[]; aliases: string[] }; bodyHtml: string } {
  const candidate = value as { metadata?: Record<string, unknown>; bodyHtml?: unknown } | null;
  return !!candidate && typeof candidate.bodyHtml === "string" && typeof candidate.metadata?.id === "string" && typeof candidate.metadata.title === "string" && (candidate.metadata.description === undefined || typeof candidate.metadata.description === "string") && typeof candidate.metadata.type === "string" && (candidate.metadata.sourceId === undefined || typeof candidate.metadata.sourceId === "string") && (candidate.metadata.createdAt === undefined || typeof candidate.metadata.createdAt === "string") && Array.isArray(candidate.metadata.tags) && candidate.metadata.tags.every((value) => typeof value === "string") && Array.isArray(candidate.metadata.aliases) && candidate.metadata.aliases.every((value) => typeof value === "string");
}
