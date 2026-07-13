import fs from "node:fs/promises";
import path from "node:path";
import {
  ALLOWED_ARTIFACT_DIRECTORIES,
  DEFAULT_ARTIFACT_BRANCH,
  DEFAULT_ARTIFACT_ROOT,
  formatZodIssue,
  normalizeArtifactMetadata,
  validateArtifactPath,
  type ArtifactMetadata as ExternalArtifactMetadata,
  type ArtifactRepositoryValidationError,
  type ArtifactRepositoryValidationResult,
} from "./artifact-contract.ts";
import matter from "gray-matter";
import { z } from "zod";

export { ALLOWED_ARTIFACT_DIRECTORIES as EXTERNAL_ARTIFACT_DIRECTORIES, DEFAULT_ARTIFACT_BRANCH as DEFAULT_EXTERNAL_ARTIFACT_BRANCH, DEFAULT_ARTIFACT_ROOT as DEFAULT_EXTERNAL_ARTIFACT_ROOT };
export type { ExternalArtifactMetadata, ArtifactRepositoryValidationError, ArtifactRepositoryValidationResult };

export type ArtifactRepositoryContract = { authoritativeBranch: string; rootPath: string; directories: readonly string[]; nestedDirectories: "supported"; idUniqueness: "global" };
export const externalArtifactRepositoryContract: ArtifactRepositoryContract = { authoritativeBranch: DEFAULT_ARTIFACT_BRANCH, rootPath: DEFAULT_ARTIFACT_ROOT, directories: ALLOWED_ARTIFACT_DIRECTORIES, nestedDirectories: "supported", idUniqueness: "global" };

async function pathExists(target: string) { try { await fs.access(target); return true; } catch { return false; } }
async function walkMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkMarkdownFiles(fullPath);
      if (entry.isFile() && entry.name.endsWith(".md")) return [fullPath];
      return [];
    }))).flat();
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
function normalizeRelative(file: string, root: string) { return path.relative(root, file).split(path.sep).join("/"); }

export async function validateExternalArtifactRepository(checkoutDir: string, options: { artifactRoot?: string } = {}): Promise<ArtifactRepositoryValidationResult> {
  const artifactRoot = options.artifactRoot ?? DEFAULT_ARTIFACT_ROOT;
  const rootDir = path.resolve(checkoutDir, artifactRoot);
  const errors: ArtifactRepositoryValidationError[] = [];
  const ids = new Map<string, string>();
  let artifactCount = 0;
  if (!(await pathExists(rootDir))) return { valid: false, artifactCount: 0, errors: [{ file: artifactRoot, reason: "Configured artifact root does not exist." }] };
  const files = await walkMarkdownFiles(rootDir);
  for (const file of files) {
    const relativeToRoot = normalizeRelative(file, rootDir);
    const displayPath = path.posix.join(artifactRoot, relativeToRoot);
    const pathError = validateArtifactPath(displayPath, artifactRoot);
    if (pathError) errors.push({ file: displayPath, reason: pathError });
    let parsed: matter.GrayMatterFile<string>;
    try { parsed = matter(await fs.readFile(file, "utf8")); } catch (error) { errors.push({ file: displayPath, reason: `Unable to parse Markdown front matter: ${(error as Error).message}` }); continue; }
    if (!String(parsed.matter ?? "").trim()) { errors.push({ file: displayPath, reason: "Missing YAML front matter." }); continue; }
    try {
      const data = normalizeArtifactMetadata(parsed.data);
      artifactCount += 1;
      const previous = ids.get(data.id);
      if (previous) errors.push({ file: displayPath, reason: `Duplicate artifact id "${data.id}" already used by ${previous}.` });
      else ids.set(data.id, displayPath);
    } catch (error) {
      if (error instanceof z.ZodError) for (const issue of error.issues) errors.push({ file: displayPath, reason: formatZodIssue(issue) });
      else errors.push({ file: displayPath, reason: (error as Error).message });
    }
  }
  return { valid: errors.length === 0, artifactCount, errors };
}
