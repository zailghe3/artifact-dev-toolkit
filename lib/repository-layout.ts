export const LEGACY_ARTIFACT_DIRECTORIES = ["prompts", "agents", "snippets", "templates", "app-ideas", "variations"] as const;
export const FUTURE_ARTIFACT_DIRECTORIES = ["prompts", "snippets", "templates", "app-ideas"] as const;

export type RepositoryLayout = "legacy" | "future";

function safeSegments(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  return segments.length > 1 && segments.every((segment) => Boolean(segment) && segment !== "." && segment !== "..") ? segments : undefined;
}

export function classifyArtifactPath(filePath: string, legacyRoot = "artifacts"): RepositoryLayout | undefined {
  const segments = safeSegments(filePath);
  if (!segments) return undefined;
  const root = legacyRoot.replace(/^\/+|\/+$/g, "");
  if (root && segments[0] === root && LEGACY_ARTIFACT_DIRECTORIES.includes(segments[1] as (typeof LEGACY_ARTIFACT_DIRECTORIES)[number])) return "legacy";
  if (FUTURE_ARTIFACT_DIRECTORIES.includes(segments[0] as (typeof FUTURE_ARTIFACT_DIRECTORIES)[number])) return "future";
  return undefined;
}

export function isSupportedArtifactPath(filePath: string, legacyRoot = "artifacts") {
  return classifyArtifactPath(filePath, legacyRoot) !== undefined && filePath.replace(/\\/g, "/").endsWith(".md");
}

export function isArtifactMarkdownCandidate(filePath: string, legacyRoot = "artifacts") {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const root = legacyRoot.replace(/^\/+|\/+$/g, "");
  return normalized.endsWith(".md") && (normalized.startsWith(`${root}/`) || FUTURE_ARTIFACT_DIRECTORIES.some((directory) => normalized.startsWith(`${directory}/`)));
}

export function definitionReadRoots(legacyRoot: string, futureRoot: string) {
  const roots = [legacyRoot, futureRoot].map((root) => root.replace(/^\/+|\/+$/g, ""));
  return roots.filter((root, index) => Boolean(root) && roots.indexOf(root) === index);
}
