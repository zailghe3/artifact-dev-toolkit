import { z } from "zod";

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
export const operationalIdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
const repositoryId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const OPERATIONAL_SETTINGS_PATH = "/v1/management/settings";
export const advisorSettingsSchema = z.object({
  workflowId: id.nullable(),
  override: z.object({
    connectionKey: id,
    model: z.string().trim().min(1).max(120).regex(/^[^\s\x00-\x1f\x7f]+$/),
  }).strict().nullable(),
}).strict();
export const advisorSettingsRecordSchema = z.object({
  settings: advisorSettingsSchema,
  revision: z.number().int().min(0).max(2_147_483_646),
}).strict();
export type AdvisorSettings = z.infer<typeof advisorSettingsSchema>;

export const codexEnvironmentInputSchema = z.object({
  key: id,
  name: z.string().trim().min(1).max(120),
  externalEnvironmentId: z.string().trim().min(1).max(255),
  enabled: z.boolean(),
}).strict();

export type CodexEnvironmentDescriptor = z.infer<typeof codexEnvironmentInputSchema>;

export const operationalSettingsCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("advisor.get"), repositoryId }).strict(),
  advisorSettingsRecordSchema.extend({ operation: z.literal("advisor.save"), repositoryId }),
  z.object({ operation: z.literal("codex.list"), repositoryId }).strict(),
  z.object({ operation: z.literal("codex.save"), repositoryId, idempotencyKey: operationalIdempotencyKeySchema, environment: codexEnvironmentInputSchema }).strict(),
  z.object({ operation: z.literal("codex.delete"), repositoryId, idempotencyKey: operationalIdempotencyKeySchema, key: id }).strict(),
]);
export type OperationalSettingsCommand = z.infer<typeof operationalSettingsCommandSchema>;
