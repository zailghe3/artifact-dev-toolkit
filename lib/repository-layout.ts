export const ARTIFACT_DIRECTORIES = ["prompts", "snippets", "templates", "app-ideas"] as const;

function safeSegments(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  return segments.length > 1 && segments.every((segment) => Boolean(segment) && segment !== "." && segment !== "..") ? segments : undefined;
}

function safeRootSegments(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/");
  return normalized && segments.every((segment) => Boolean(segment) && segment !== "." && segment !== "..") ? segments : undefined;
}

export function normalizeRepositoryRoot(value: string) {
  return safeRootSegments(value)?.join("/");
}

export function classifyArtifactPath(filePath: string, _legacyRoot?: string): "canonical" | undefined {
  const segments = safeSegments(filePath);
  if (!segments) return undefined;
  if (ARTIFACT_DIRECTORIES.includes(segments[0] as (typeof ARTIFACT_DIRECTORIES)[number])) return "canonical";
  return undefined;
}

export function isSupportedArtifactPath(filePath: string, _legacyRoot?: string) {
  return classifyArtifactPath(filePath) !== undefined && filePath.replace(/\\/g, "/").endsWith(".md");
}

const artifactTypeDirectories = {
  prompt: "prompts",
  snippet: "snippets",
  template: "templates",
  "app-idea": "app-ideas",
} as const;

/** Return the trusted Phase 2 write target for a newly-created Artifact Library item. */
export function canonicalArtifactWritePath(type: keyof typeof artifactTypeDirectories, id: string, _legacyRoot?: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return undefined;
  const directory = artifactTypeDirectories[type];
  return `${directory}/${id}.md`;
}

/** Existing mutations may target either layout, but only an exact supported Markdown path. */
export function isSupportedArtifactMutationPath(filePath: string, _legacyRoot?: string) {
  return isSupportedArtifactPath(filePath);
}

export function isArtifactMarkdownCandidate(filePath: string, _legacyRoot?: string) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.endsWith(".md") && ARTIFACT_DIRECTORIES.some((directory) => normalized.startsWith(`${directory}/`));
}
