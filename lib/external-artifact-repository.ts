import fs from "node:fs/promises";
import path from "node:path";
import {
  ALLOWED_ARTIFACT_DIRECTORIES,
  DEFAULT_ARTIFACT_BRANCH,
  DEFAULT_ARTIFACT_ROOT,
  formatZodIssue,
  artifactFrontMatterSchema,
  validateArtifactPath,
  type ArtifactMetadata as ExternalArtifactMetadata,
  type ArtifactRepositoryValidationError,
  type ArtifactRepositoryValidationResult,
} from "./artifact-contract.ts";
import { classifyArtifactPath, FUTURE_ARTIFACT_DIRECTORIES, normalizeRepositoryRoot } from "./repository-layout.ts";
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
  const configuredRoot = options.artifactRoot ?? DEFAULT_ARTIFACT_ROOT;
  const artifactRoot = normalizeRepositoryRoot(configuredRoot);
  if (!artifactRoot) return { valid: false, artifactCount: 0, errors: [{ file: configuredRoot, reason: "The configured artifact root must be a safe repository-relative path without empty or traversal segments." }] };
  const checkoutRoot = path.resolve(checkoutDir);
  const rootDir = path.resolve(checkoutRoot, artifactRoot);
  const errors: ArtifactRepositoryValidationError[] = [];
  const ids = new Map<string, string>();
  let artifactCount = 0;
  const legacyExists = await pathExists(rootDir);
  const futureRoots = FUTURE_ARTIFACT_DIRECTORIES.map((directory) => path.resolve(checkoutRoot, directory));
  const existingFutureRoots = (await Promise.all(futureRoots.map(async (root) => await pathExists(root) ? root : undefined))).filter((root): root is string => Boolean(root));
  if (!legacyExists && existingFutureRoots.length === 0) return { valid: false, artifactCount: 0, errors: [{ file: artifactRoot, reason: "Neither the configured legacy artifact root nor a compatible root-level artifact directory exists." }] };
  const discoveryRoots = [...new Set([...(legacyExists ? [rootDir] : []), ...existingFutureRoots])];
  const files = new Map<string, string>();
  for (const file of (await Promise.all(discoveryRoots.map(walkMarkdownFiles))).flat()) files.set(normalizeRelative(file, checkoutRoot), file);
  for (const [displayPath, file] of files) {
    const layout = classifyArtifactPath(displayPath, artifactRoot);
    if (!layout) {
      errors.push({ file: displayPath, reason: validateArtifactPath(displayPath, artifactRoot) ?? "Markdown artifact path is not supported by the configured repository layout." });
      continue;
    }
    if (layout === "legacy") { const pathError = validateArtifactPath(displayPath, artifactRoot); if (pathError) errors.push({ file: displayPath, reason: pathError }); }
    let parsed: matter.GrayMatterFile<string>;
    try { parsed = matter(await fs.readFile(file, "utf8"), {}); } catch (error) { errors.push({ file: displayPath, reason: `Unable to parse Markdown front matter: ${(error as Error).message}` }); continue; }
    if (!String(parsed.matter ?? "").trim()) { errors.push({ file: displayPath, reason: "Missing YAML front matter." }); continue; }
    try {
      const data = artifactFrontMatterSchema.parse(parsed.data);
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
