import { z } from "zod";

export const artifactTypeSchema = z.enum(["prompt", "agent", "snippet", "template", "app-idea"]);

export const artifactMetadataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().max(2000).default(""),
  type: artifactTypeSchema,
  tags: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  sourceId: z.string().optional(),
  createdAt: z.string().optional(),
});
