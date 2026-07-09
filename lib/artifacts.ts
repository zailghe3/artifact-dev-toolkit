import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

const artifactsDir = path.join(process.cwd(), "artifacts");

export const artifactStatusSchema = z.enum(["production", "draft", "archived"]);
export const artifactTypeSchema = z.enum(["prompt", "agent", "snippet", "template", "app-idea"]);

const artifactSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: artifactTypeSchema,
  status: artifactStatusSchema,
  tags: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  sourceId: z.string().optional(),
  createdAt: z.string().optional(),
});

export type Artifact = z.infer<typeof artifactSchema> & {
  body: string;
  excerpt: string;
  path: string;
};

export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

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

export async function getArtifacts(): Promise<Artifact[]> {
  const files = await walkMarkdownFiles(artifactsDir);
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

export async function getArtifact(id: string) {
  const artifacts = await getArtifacts();
  return artifacts.find((artifact) => artifact.id === id);
}


export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);
}

export async function createVariation(source: Artifact, body: string, title?: string) {
  const timestamp = new Date().toISOString();
  const idBase = slugify(title || `${source.id} variation`);
  const id = `${idBase}-${timestamp.slice(0, 10)}-${timestamp.slice(11, 19).replace(/:/g, "")}`;
  const filePath = path.join(artifactsDir, "variations", `${id}.md`);
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

  await fs.writeFile(filePath, markdown, "utf8");
  return id;
}
