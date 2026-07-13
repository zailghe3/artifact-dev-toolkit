import matter from "gray-matter";
import { z } from "zod";
import { artifactStatusSchema, artifactTypeSchema } from "./artifact-schemas.ts";

export const ALLOWED_ARTIFACT_DIRECTORIES = ["prompts", "agents", "snippets", "templates", "app-ideas", "variations"] as const;
export const DEFAULT_ARTIFACT_BRANCH = "main";
export const DEFAULT_ARTIFACT_ROOT = "artifacts";

export const artifactFrontMatterSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
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

export function toExcerpt(body: string) { return body.replace(/\s+/g, " ").trim().slice(0, 180); }
export function trimSlashes(value: string) { return value.replace(/^\/+|\/+$/g, ""); }

export function normalizeArtifactMetadata(input: unknown): ArtifactMetadata {
  const data = artifactFrontMatterSchema.parse(input);
  return { ...data, createdAt: data.createdAt instanceof Date ? data.createdAt.toISOString() : data.createdAt };
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
  const [topLevel] = relative.split("/");
  if (!ALLOWED_ARTIFACT_DIRECTORIES.includes(topLevel as (typeof ALLOWED_ARTIFACT_DIRECTORIES)[number])) {
    return `Markdown artifacts must be stored under one of: ${ALLOWED_ARTIFACT_DIRECTORIES.join(", ")}.`;
  }
  return undefined;
}

export function parseArtifactMarkdown(raw: string, filePath: string): ArtifactModel {
  let parsed: matter.GrayMatterFile<string>;
  try { parsed = matter(raw); } catch (error) { throw new Error(formatArtifactDiagnostic(filePath, `Unable to parse Markdown front matter: ${(error as Error).message}`)); }
  if (!String(parsed.matter ?? "").trim()) throw new Error(formatArtifactDiagnostic(filePath, "Missing YAML front matter."));
  try {
    const data = normalizeArtifactMetadata(parsed.data);
    return { ...data, body: parsed.content.trim(), excerpt: toExcerpt(parsed.content), path: filePath };
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error(error.issues.map((issue) => formatArtifactDiagnostic(filePath, formatZodIssue(issue))).join("; "));
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
