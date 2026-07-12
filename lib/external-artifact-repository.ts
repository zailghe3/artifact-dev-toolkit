import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { artifactStatusSchema, artifactTypeSchema } from "./artifact-schemas.ts";

export const EXTERNAL_ARTIFACT_DIRECTORIES = ["prompts", "agents", "snippets", "templates", "app-ideas", "variations"] as const;
export const DEFAULT_EXTERNAL_ARTIFACT_BRANCH = "main";
export const DEFAULT_EXTERNAL_ARTIFACT_ROOT = "artifacts";

const externalArtifactSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  type: artifactTypeSchema,
  status: artifactStatusSchema,
  tags: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  sourceId: z.string().trim().min(1).optional(),
  createdAt: z.union([z.string().datetime({ offset: true }), z.date()]).optional(),
});

export type ExternalArtifactMetadata = z.infer<typeof externalArtifactSchema>;

export type ArtifactRepositoryContract = {
  authoritativeBranch: string;
  rootPath: string;
  directories: readonly string[];
  nestedDirectories: "supported";
  idUniqueness: "global";
};

export const externalArtifactRepositoryContract: ArtifactRepositoryContract = {
  authoritativeBranch: DEFAULT_EXTERNAL_ARTIFACT_BRANCH,
  rootPath: DEFAULT_EXTERNAL_ARTIFACT_ROOT,
  directories: EXTERNAL_ARTIFACT_DIRECTORIES,
  nestedDirectories: "supported",
  idUniqueness: "global",
};

export type ArtifactRepositoryValidationError = {
  file: string;
  reason: string;
};

export type ArtifactRepositoryValidationResult = {
  valid: boolean;
  artifactCount: number;
  errors: ArtifactRepositoryValidationError[];
};

async function pathExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return walkMarkdownFiles(fullPath);
        if (entry.isFile() && entry.name.endsWith(".md")) return [fullPath];
        return [];
      }),
    );
    return nested.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function formatZodIssue(issue: z.ZodIssue) {
  const field = issue.path.length > 0 ? issue.path.join(".") : "front matter";
  return `${field}: ${issue.message}`;
}

function normalizeRelative(file: string, root: string) {
  return path.relative(root, file).split(path.sep).join("/");
}

export async function validateExternalArtifactRepository(
  checkoutDir: string,
  options: { artifactRoot?: string } = {},
): Promise<ArtifactRepositoryValidationResult> {
  const artifactRoot = options.artifactRoot ?? DEFAULT_EXTERNAL_ARTIFACT_ROOT;
  const rootDir = path.resolve(checkoutDir, artifactRoot);
  const errors: ArtifactRepositoryValidationError[] = [];
  const ids = new Map<string, string>();
  let artifactCount = 0;

  if (!(await pathExists(rootDir))) {
    return {
      valid: false,
      artifactCount: 0,
      errors: [{ file: artifactRoot, reason: "Configured artifact root does not exist." }],
    };
  }

  for (const directory of EXTERNAL_ARTIFACT_DIRECTORIES) {
    const fullPath = path.join(rootDir, directory);
    if (!(await pathExists(fullPath))) {
      errors.push({ file: path.posix.join(artifactRoot, directory), reason: "Expected artifact type directory is missing." });
    }
  }

  const files = await walkMarkdownFiles(rootDir);
  const allowedTopLevel = new Set<string>(EXTERNAL_ARTIFACT_DIRECTORIES);

  for (const file of files) {
    const relativeToRoot = normalizeRelative(file, rootDir);
    const displayPath = path.posix.join(artifactRoot, relativeToRoot);
    const [topLevel] = relativeToRoot.split("/");

    if (!allowedTopLevel.has(topLevel)) {
      errors.push({ file: displayPath, reason: `Markdown artifacts must be stored under one of: ${EXTERNAL_ARTIFACT_DIRECTORIES.join(", ")}.` });
    }

    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(await fs.readFile(file, "utf8"));
    } catch (error) {
      errors.push({ file: displayPath, reason: `Unable to parse Markdown front matter: ${(error as Error).message}` });
      continue;
    }

    if (!parsed.matter.trim()) {
      errors.push({ file: displayPath, reason: "Missing YAML front matter." });
      continue;
    }

    const validation = externalArtifactSchema.safeParse(parsed.data);
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        errors.push({ file: displayPath, reason: formatZodIssue(issue) });
      }
      continue;
    }

    artifactCount += 1;
    const previous = ids.get(validation.data.id);
    if (previous) {
      errors.push({ file: displayPath, reason: `Duplicate artifact id "${validation.data.id}" already used by ${previous}.` });
    } else {
      ids.set(validation.data.id, displayPath);
    }
  }

  return { valid: errors.length === 0, artifactCount, errors };
}
