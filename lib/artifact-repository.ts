import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { artifactMetadataSchema, artifactStatusSchema, artifactTypeSchema } from "./artifact-schemas";

const artifactsDir = path.join(process.cwd(), "artifacts");

const artifactSchema = artifactMetadataSchema;

export type Artifact = z.infer<typeof artifactSchema> & {
  body: string;
  excerpt: string;
  path: string;
};

export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

export type CreateVariationInput = {
  source: Artifact;
  body: string;
  title?: string;
};

export interface ArtifactRepository {
  list(): Promise<Artifact[]>;
  findById(id: string): Promise<Artifact | undefined>;
  createVariation(input: CreateVariationInput): Promise<string>;
}

const secretPatterns = [
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i,
  /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}_[A-Za-z0-9_]{59,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
];

function assertNoSecrets(value: string) {
  if (secretPatterns.some((pattern) => pattern.test(value))) {
    throw new Error("Refusing to persist content that looks like a secret or API key.");
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

function toExcerpt(body: string) {
  return body.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);
}

export class FileArtifactRepository implements ArtifactRepository {
  constructor(private readonly rootDir = artifactsDir) {}

  async list(): Promise<Artifact[]> {
    const files = await walkMarkdownFiles(this.rootDir);
    const artifacts = await Promise.all(
      files.map(async (file) => {
        const raw = await fs.readFile(file, "utf8");
        const parsed = matter(raw);
        const data = artifactSchema.parse(parsed.data);
        return {
          ...data,
          body: parsed.content.trim(),
          excerpt: toExcerpt(parsed.content),
          path: path.relative(process.cwd(), file),
        };
      }),
    );

    return artifacts.sort((a, b) => a.title.localeCompare(b.title));
  }

  async findById(id: string) {
    const artifacts = await this.list();
    return artifacts.find((artifact) => artifact.id === id);
  }

  async createVariation({ source, body, title }: CreateVariationInput) {
    assertNoSecrets(body);
    assertNoSecrets(title ?? "");

    const timestamp = new Date().toISOString();
    const idBase = slugify(title || `${source.id} variation`);
    const id = `${idBase}-${timestamp.slice(0, 10)}-${timestamp.slice(11, 19).replace(/:/g, "")}`;
    const filePath = path.join(this.rootDir, "variations", `${id}.md`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const markdown = matter.stringify(`${body.trim()}\n`, {
      id,
      title: title?.trim() || `${source.title} Variation`,
      type: source.type,
      status: "draft",
      tags: Array.from(new Set([...source.tags, "variation"])),
      aliases: source.aliases,
      sourceId: source.id,
      createdAt: timestamp,
    });

    assertNoSecrets(markdown);
    await fs.writeFile(filePath, markdown, "utf8");
    return id;
  }
}

export class GitHubArtifactRepository implements ArtifactRepository {
  async list(): Promise<Artifact[]> {
    throw new Error(
      "GitHubArtifactRepository is not implemented yet. Future implementations must read GitHub credentials from environment variables or a secrets manager only, never from committed files.",
    );
  }

  async findById(id: string): Promise<Artifact | undefined> {
    void id;
    throw new Error("GitHubArtifactRepository is not implemented yet.");
  }

  async createVariation(input: CreateVariationInput): Promise<string> {
    assertNoSecrets(input.body);
    assertNoSecrets(input.title ?? "");
    throw new Error("GitHubArtifactRepository is not implemented yet.");
  }
}

export function createArtifactRepository(): ArtifactRepository {
  if (process.env.ARTIFACT_REPOSITORY === "github") {
    return new GitHubArtifactRepository();
  }

  return new FileArtifactRepository();
}
