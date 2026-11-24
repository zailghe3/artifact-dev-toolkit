import { z } from "zod";

export const RUNTIME_CONTROL_PATH = "/v1/management/control";
export const RUNTIME_REPOSITORY_BROKER_PATH = "/api/runtime-repository-credential";
export const RUNTIME_CONTROL_BYTES = 16 * 1024 * 1024;
const repositoryId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const repoName = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);

export const repositoryContextSchema = z.object({
  repositoryId,
  installationId: repositoryId,
  owner: repoName,
  repository: repoName,
  branch: z.string().min(1).max(255),
  root: z.string().min(1).max(255),
}).strict();

export const managedContextSchema = z.object({
  repositoryId,
  installationId: repositoryId,
  owner: repoName,
  repository: repoName,
  baseBranch: z.string().min(1).max(255),
  environmentKey: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  managed: z.literal(true),
}).strict();

export const repositoryBrokerRequestSchema = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("artifacts"), context: repositoryContextSchema }).strict(),
  z.object({
    purpose: z.literal("publication"), scope: repositoryContextSchema, context: managedContextSchema,
    capability: z.enum(["write", "pull_requests"]), runId: z.string().uuid(),
    authority: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }).strict(),
]);

export const toolDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approval"), approvalId: z.string().uuid(), decisionId: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]), sensitiveDisclosureAcknowledged: z.literal(true).optional(),
  }).strict(),
  z.object({
    action: z.literal("reconcile"), invocationId: z.string().regex(/^[a-f0-9]{64}$/), admissionId: z.string().uuid(),
    decisionId: z.string().uuid(), decision: z.enum(["success", "not_executed", "unresolved", "terminate"]),
    basis: z.string().trim().min(1).max(4_000), result: z.string().max(128_000).optional(),
  }).strict(),
]);

export const vaultOperations = [
  "create", "resolve", "resolveWithRevision", "replace", "replaceIfRevision", "delete", "recover",
  "currentMcpServerCredentialBinding", "ensureMcpServerCredentialBinding", "rotateMcpServerCredential",
  "replaceMcpServerCredentialBinding", "restoreMcpServerCredentialBinding", "resolveMcpServerCredential",
  "revokeMcpServerCredentialBinding", "createSecurityProfileCredentialBinding", "recoverSecurityProfileCredentialBinding",
  "rotateSecurityProfileCredential", "replaceSecurityProfileCredentialBinding", "currentSecurityProfileCredentialBinding",
  "resolveSecurityProfileCredential", "revokeSecurityProfileCredentialBinding",
] as const;

const runId = z.string().uuid();
const actor = z.string().min(1).max(64).regex(/^[a-zA-Z0-9-]+$/);
const publicationInput = z.object({
  runId, stepId: z.string().min(1).max(128), title: z.string().trim().min(1).max(256),
  body: z.string().max(65_536), draft: z.boolean(),
});
export const policyOperations = ["head","attestation","verify","verifyFrozen","begin","publish","settle","inspect"] as const;
export const workIqOperations = ["begin","lookup","discard","complete"] as const;
export const knowledgeOperations = ["get","list","save","review","claim","finish"] as const;

export const runnerOperations = ["capabilities","managedRepository","environments","workspaceDiagnostics","sandboxDiagnostics",
 "models","authStatus","authEnvironmentDiagnostics","sqliteStorage","createSqliteBackup","restoreSqliteBackup","testCodex",
 "jobs","controlStatus","emergencyStop","resume","startDeviceAuth","logout"] as const;

export const runtimeControlSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("runs.health"), repositoryId, scope: repositoryContextSchema }).strict(),
  z.object({ operation: z.literal("runs.list"), repositoryId, limit: z.number().int().min(1).max(100) }).strict(),
  z.object({ operation: z.literal("runs.detail"), repositoryId, runId }).strict(),
  z.object({ operation: z.literal("runs.find"), repositoryId, key: z.string().min(1).max(128) }).strict(),
  z.object({ operation: z.literal("runs.launch"), repositoryId, snapshot: z.record(z.string(), z.unknown()),
    publicationAuthorities: z.record(z.string(), z.string().regex(/^[A-Za-z0-9_-]{43}$/)).optional() }).strict(),
  z.object({ operation: z.literal("runs.cancel"), repositoryId, runId }).strict(),
  z.object({ operation: z.literal("runs.retry"), repositoryId, runId }).strict(),
  z.object({ operation: z.literal("runs.approval"), repositoryId, runId, approvalRequestId: runId }).strict(),
  z.object({ operation: z.literal("runs.inspection"), repositoryId, runId, actor }).strict(),
  z.object({ operation: z.literal("runs.tools"), repositoryId, runId, actor, decision: toolDecisionSchema.optional() }).strict(),
  publicationInput.extend({ operation: z.literal("runs.publish"), repositoryId }).strict(),
  z.object({ operation: z.literal("broker.claim"), nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    timestamp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ operation: z.literal("runner.release") }).strict(),
  z.object({ operation: z.literal("runner"), repositoryId, method: z.enum(runnerOperations),
    arguments: z.array(z.union([z.string().max(120),z.number().int()])).max(1) }).strict(),
  z.object({ operation: z.literal("policy"), repositoryId, method: z.enum(policyOperations),
    arguments: z.array(z.unknown()).max(4) }).strict(),
  z.object({ operation: z.literal("work-iq"), repositoryId, method: z.enum(workIqOperations),
    arguments: z.array(z.unknown()).max(2) }).strict(),
  z.object({ operation: z.literal("knowledge"), repositoryId, scope: repositoryContextSchema,
    actor: z.object({ githubId: repositoryId, login: actor, sessionId: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    method: z.enum(knowledgeOperations), arguments: z.array(z.unknown()).max(4) }).strict(),
  z.object({ operation: z.literal("vault"), repositoryId, method: z.enum(vaultOperations),
    arguments: z.array(z.unknown()).max(8) }).strict(),
]);
export type RuntimeControlCommand = z.infer<typeof runtimeControlSchema>;
export type RepositoryBrokerRequest = z.infer<typeof repositoryBrokerRequestSchema>;
