import { z } from "zod";

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
export const operationalIdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
const repositoryId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const OPERATIONAL_SETTINGS_PATH = "/v1/management/settings";
export const OPERATIONAL_SETTINGS_BYTES = 8192;
export const advisorSettingsSchema = z.object({
  workflowId: id.nullable(),
  override: z.object({
    connectionKey: id,
    model: z.string().trim().min(1).max(120).regex(/^[^\s\x00-\x1f\x7f]+$/),
  }).strict().nullable(),
}).strict();
const maxAdvisorRevision = 2_147_483_647;
export const advisorSettingsRecordSchema = z.object({
  settings: advisorSettingsSchema,
  revision: z.number().int().min(0).max(maxAdvisorRevision),
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
  advisorSettingsRecordSchema.extend({ operation: z.literal("advisor.save"), repositoryId,
    revision: advisorSettingsRecordSchema.shape.revision.max(maxAdvisorRevision - 1) }),
  z.object({ operation: z.literal("codex.list"), repositoryId }).strict(),
  z.object({ operation: z.literal("codex.save"), repositoryId, idempotencyKey: operationalIdempotencyKeySchema, environment: codexEnvironmentInputSchema }).strict(),
  z.object({ operation: z.literal("codex.delete"), repositoryId, idempotencyKey: operationalIdempotencyKeySchema, key: id }).strict(),
]);
export type OperationalSettingsCommand = z.infer<typeof operationalSettingsCommandSchema>;

export const operationalSettingsResults = {
  "advisor.get": advisorSettingsRecordSchema,
  "advisor.save": advisorSettingsRecordSchema,
  "codex.list": codexEnvironmentInputSchema.array(),
  "codex.save": codexEnvironmentInputSchema,
  "codex.delete": z.null(),
};

export const operationalSettingsFailures = {
  runtime_settings_authentication_failed: { status: 401, stage: "authentication" },
  runtime_settings_protocol_incompatible: { status: 409, stage: "protocol" },
  runtime_settings_request_rejected: { status: 400, stage: "validation" },
  runtime_settings_body_too_large: { status: 413, stage: "validation" },
  runtime_settings_unavailable: { status: 503, stage: "dispatch" },
  runtime_settings_nonce_unavailable: { status: 503, stage: "nonce" },
  runtime_settings_replay_rejected: { status: 401, stage: "nonce" },
  runtime_settings_storage_unavailable: { status: 503, stage: "storage" },
  runtime_settings_data_invalid: { status: 503, stage: "response_validation" },
  advisor_settings_conflict: { status: 409, stage: "storage" },
  runtime_settings_conflict: { status: 409, stage: "storage" },
} as const;

export type OperationalSettingsFailureCode = keyof typeof operationalSettingsFailures;

export function isOperationalSettingsFailureCode(value: unknown): value is OperationalSettingsFailureCode {
  return typeof value === "string" && Object.hasOwn(operationalSettingsFailures, value);
}
