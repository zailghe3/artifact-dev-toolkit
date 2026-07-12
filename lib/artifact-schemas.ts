import { z } from "zod";

export const artifactStatusSchema = z.enum(["production", "draft", "archived"]);
export const artifactTypeSchema = z.enum(["prompt", "agent", "snippet", "template", "app-idea"]);

export const artifactMetadataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: artifactTypeSchema,
  status: artifactStatusSchema,
  tags: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  sourceId: z.string().optional(),
  createdAt: z.string().optional(),
});
