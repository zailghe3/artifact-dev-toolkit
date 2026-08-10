import matter from "gray-matter";
import { z } from "zod";
import { artifactStatusSchema, artifactTypeSchema } from "./artifact-schemas.ts";

export const ALLOWED_ARTIFACT_DIRECTORIES = ["prompts", "agents", "snippets", "templates", "app-ideas", "variations"] as const;
export const DEFAULT_ARTIFACT_BRANCH = "main";
export const DEFAULT_ARTIFACT_ROOT = "artifacts";
/** Maximum UTF-8 size of a complete serialized Markdown artifact (1 MiB). */
export const MAX_SERIALIZED_ARTIFACT_BYTES = 1024 * 1024;

export const artifactFrontMatterSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().max(2000).default(""),
  type: artifactTypeSchema,
  status: artifactStatusSchema,
  tags: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  sourceId: z.string().trim().min(1).optional(),
  createdAt: z.union([z.string().datetime({ offset: true }), z.date()]).optional(),
});

export type ArtifactMetadata = z.infer<typeof artifactFrontMatterSchema>;
export type ArtifactModel = ArtifactMetadata & { body: string; excerpt: string; path: string };
export type ArtifactRepositoryValidationError = { file: string; reason: string };
export type ArtifactRepositoryValidationResult = { valid: boolean; artifactCount: number; errors: ArtifactRepositoryValidationError[] };
export class ArtifactMarkdownParseError extends Error {
  readonly code: "invalid_front_matter" | "invalid_metadata" | "invalid_body";
  constructor(code: "invalid_front_matter" | "invalid_metadata" | "invalid_body") { super("Artifact Markdown is invalid."); this.code = code; }
}

export function toExcerpt(body: string) { return body.replace(/\s+/g, " ").trim().slice(0, 180); }
export function trimSlashes(value: string) { return value.replace(/^\/+|\/+$/g, ""); }

export function normalizeArtifactMetadata(input: unknown): ArtifactMetadata {
  const data = artifactFrontMatterSchema.parse(input);
  const normalizeList = (values: string[]) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return { ...data, tags: normalizeList(data.tags), aliases: normalizeList(data.aliases), createdAt: data.createdAt instanceof Date ? data.createdAt.toISOString() : data.createdAt };
}

/** Serialize the complete, validated artifact in the repository's canonical format. */
export function serializeArtifactMarkdown(metadata: unknown, body: string): string {
  const data = normalizeArtifactMetadata(metadata);
  const markdown = matter.stringify(`${body.trim()}\n`, {
    id: data.id,
    title: data.title,
    ...(metadata && typeof metadata === "object" && Object.prototype.hasOwnProperty.call(metadata,"description") && data.description.length>0 ? { description: data.description } : {}),
    type: data.type,
    status: data.status,
    tags: data.tags,
    aliases: data.aliases,
    ...(data.sourceId ? { sourceId: data.sourceId } : {}),
    ...(data.createdAt ? { createdAt: data.createdAt } : {}),
  });
  // Parsing the serialized result keeps writes and repository reads on one contract.
  parseArtifactMarkdown(markdown, "artifact.md");
  return markdown;
}

export function formatZodIssue(issue: z.ZodIssue) {
  const field = issue.path.length > 0 ? issue.path.join(".") : "front matter";
  return `${field}: ${issue.message}`;
}

export function formatArtifactDiagnostic(file: string, reason: string) { return `${file}: ${reason}`; }

export function validateArtifactPath(filePath: string, artifactRoot = DEFAULT_ARTIFACT_ROOT) {
  const root = trimSlashes(artifactRoot);
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const prefix = root ? `${root}/` : "";
  if (!normalized.startsWith(prefix)) return `Markdown artifacts must be stored under ${root || "the configured artifact root"}.`;
  const relative = normalized.slice(prefix.length);
  if (!relative || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return "Markdown artifact paths must not contain empty or traversal segments.";
  }
  const [topLevel] = relative.split("/");
  if (!ALLOWED_ARTIFACT_DIRECTORIES.includes(topLevel as (typeof ALLOWED_ARTIFACT_DIRECTORIES)[number])) {
    return `Markdown artifacts must be stored under one of: ${ALLOWED_ARTIFACT_DIRECTORIES.join(", ")}.`;
  }
  return undefined;
}

export function parseArtifactMarkdown(raw: string, filePath: string): ArtifactModel {
  let parsed: matter.GrayMatterFile<string>;
  // Supplying options disables gray-matter's process-global cache. Repository reads
  // must parse each response independently so repeated loads cannot share mutable state.
  try { parsed = matter(raw, {}); } catch { throw new ArtifactMarkdownParseError("invalid_front_matter"); }
  if (!String(parsed.matter ?? "").trim()) throw new ArtifactMarkdownParseError("invalid_front_matter");
  try {
    const data = normalizeArtifactMetadata(parsed.data);
    return { ...data, body: parsed.content.trim(), excerpt: toExcerpt(parsed.content), path: filePath };
  } catch (error) {
    if (error instanceof z.ZodError) throw new ArtifactMarkdownParseError("invalid_metadata");
    throw error;
  }
}

export function validateUniqueArtifactIds(artifacts: Pick<ArtifactModel, "id" | "path">[]) {
  const seen = new Map<string, string>();
  for (const artifact of artifacts) {
    const previous = seen.get(artifact.id);
    if (previous) throw new Error(`Duplicate artifact id "${artifact.id}" found in ${artifact.path}; already used by ${previous}.`);
    seen.set(artifact.id, artifact.path);
  }
}
