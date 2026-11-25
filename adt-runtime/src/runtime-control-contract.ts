import { z } from "zod";

export const RUNTIME_CONTROL_PATH = "/v1/management/control";
export const RUNTIME_REPOSITORY_BROKER_PATH = "/api/runtime-repository-credential";
export const RUNTIME_CONTROL_BYTES = 16 * 1024 * 1024;
export const RUNTIME_MANAGEMENT_DIAGNOSTIC_SCHEMA = "adt.runtime-management.v1";
export const RUNTIME_MANAGEMENT_DIAGNOSTIC_TIMEOUT_MS = 25_000;
export const managementStageSchema = z.enum(["configuration", "transport", "response", "authentication",
  "protocol", "validation", "management", "nonce", "dispatch", "storage", "complete"]);
export const managementResultSchema = z.enum(["ok", "not_configured", "unreachable", "malformed_response",
  "authentication_failed", "protocol_incompatible", "request_rejected", "management_unavailable",
  "nonce_persistence_unavailable", "storage_query_unavailable", "storage_data_invalid", "operation_rejected"]);
export const managementEvidenceSchema = z.object({
  requestId: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  stage: managementStageSchema,
  result: managementResultSchema,
  authenticated: z.boolean().nullable(),
  protocolCompatible: z.boolean().nullable(),
  noncePersisted: z.boolean().nullable(),
  accepted: z.boolean().nullable(),
  dispatched: z.boolean().nullable(),
}).strict();
export const managementObservationSchema = managementEvidenceSchema.extend({
  httpStatus: z.number().int().min(100).max(599).optional(),
  elapsedMs: z.number().int().nonnegative(),
}).strict();
export const dependencyObservationSchema = z.object({
  status: z.enum(["available", "unavailable", "not_verified"]),
  elapsedMs: z.number().int().nonnegative().optional(),
  result: z.enum(["storage_query_unavailable", "storage_data_invalid"]).optional(),
}).strict();
export const managementDependenciesSchema = z.object({
  postgres: dependencyObservationSchema,
  checkpoints: dependencyObservationSchema,
  workflow: dependencyObservationSchema,
  broker: dependencyObservationSchema,
}).strict();
export const runtimeManagementDiagnosticSchema = z.object({
  schema: z.literal(RUNTIME_MANAGEMENT_DIAGNOSTIC_SCHEMA),
  management: managementObservationSchema,
  workflowHistory: managementObservationSchema.optional(),
  dependencies: managementDependenciesSchema,
}).strict();
export type ManagementEvidence = z.infer<typeof managementEvidenceSchema>;
export type ManagementObservation = z.infer<typeof managementObservationSchema>;
export type ManagementDependencies = z.infer<typeof managementDependenciesSchema>;
export type RuntimeManagementDiagnostic = z.infer<typeof runtimeManagementDiagnosticSchema>;

// These statuses and messages describe operation failures. A dependency's
// authentication failure does not establish the browser user's permissions.
const runtimeControlOperationErrors = {
  vault_secret_id_invalid: { status: 400, error: "The credential reference is invalid." },
  provider_configuration_invalid: { status: 422, error: "The provider configuration is invalid." },
  ollama_configuration_invalid: { status: 422, error: "Ollama base URL or authentication mode is invalid." },
  definition_repository_unavailable: { status: 503, error: "The definition repository is temporarily unavailable." },
  invalid_managed_continuation: { status: 409, error: "The prior managed publication is unavailable for continuation." },
  conversation_unavailable: { status: 409, error: "The selected Codex conversation is no longer available." },
  github_pull_request_permission_denied: { status: 502, error: "GitHub denied the pull request operation." },
  github_pull_request_not_found: { status: 404, error: "The GitHub pull request was not found." },
  github_pull_request_conflict: { status: 409, error: "The GitHub pull request operation conflicted with current state." },
  github_pull_request_rate_limited: { status: 429, error: "GitHub rate limited the pull request operation." },
  github_pull_request_temporarily_unavailable: { status: 503, error: "The GitHub pull request service is temporarily unavailable." },
  github_pull_request_malformed_response: { status: 502, error: "GitHub returned an invalid pull request response." },
  configuration_missing: { status: 503, error: "Codex Runner is not configured." },
  runner_unavailable: { status: 503, error: "Codex Runner is temporarily unavailable." },
  access_denied: { status: 502, error: "The request to Codex Runner was denied." },
  runner_unauthorized: { status: 502, error: "Codex Runner rejected service authentication." },
  runner_update_required: { status: 409, error: "Codex Runner requires an update." },
  invalid_response: { status: 502, error: "Codex Runner returned an invalid response." },
  operation_unavailable: { status: 409, error: "This operation is unavailable on Codex Runner." },
  request_too_large: { status: 413, error: "The request exceeds the service limit." },
  not_found: { status: 404, error: "The requested resource was not found." },
  managed_environment_unavailable: { status: 409, error: "The managed Codex environment is unavailable." },
  managed_task_not_found: { status: 404, error: "The managed Codex task was not found." },
  managed_repository_identity_mismatch: { status: 409, error: "The managed repository identity has changed." },
  repository_state_invalid: { status: 409, error: "The managed repository state is invalid." },
  workspace_outside_root: { status: 400, error: "The managed workspace is outside the configured root." },
  repository_operation_failed: { status: 409, error: "The managed repository operation failed." },
  repository_operation_timeout: { status: 503, error: "The managed repository operation timed out." },
  repository_manager_unavailable: { status: 503, error: "The managed repository service is temporarily unavailable." },
  repository_manager_invalid_response: { status: 502, error: "The managed repository service returned an invalid response." },
  repository_publish_result_unknown: { status: 503, error: "The managed repository publication outcome is unknown." },
} as const;
type RuntimeControlOperationError = keyof typeof runtimeControlOperationErrors;

export function runtimeControlOperationErrorResponse(code: string) {
  return Object.hasOwn(runtimeControlOperationErrors, code)
    ? runtimeControlOperationErrors[code as RuntimeControlOperationError]
    : undefined;
}

// Application errors that are part of the management protocol. Other failures
// are classified at the boundary, without sending upstream exception messages.
export const runtimeControlErrorCodeSchema = z.enum([
  "runtime_unavailable", "runtime_authentication_failed", "protocol_incompatible", "invalid_request",
  "permission_denied", "run_not_found", "github_broker_unavailable", "legacy_run_read_only",
  "invalid_run_snapshot", "invalid_retry", "invalid_cancellation", "invalid_launch_state", "invalid_step_claim",
  "invalid_attempt_state", "invalid_run_state", "invalid_graph_activation", "invalid_conversation_source",
  "workflow_generation_conflict", "workflow_idempotency_conflict", "workflow_instance_conflict",
  "run_conflict", "run_not_active", "attempt_not_found", "completion_conflict", "cancellation_result_conflict",
  "approval_invalid", "approval_missing", "approval_wrong_run", "approval_not_pending", "approval_conflict",
  "approval_stale", "approval_consume_conflict", "reconciliation_conflict", "reconciliation_evidence_required",
  "reconciliation_not_pending", "security_evidence_invalid", "managed_codex_result_required",
  "managed_publication_conflict", "managed_publication_write_permission_missing", "managed_task_has_no_changes",
  "invalid_managed_pr_association", "provider_publish_ambiguous", "conversation_source_incompatible",
  "provider_unavailable", "provider_timeout", "provider_rejected", "provider_request_rejected",
  "authentication_failed", "rate_limited", "credential_required", "malformed_response", "output_too_large",
  "unsupported_adapter", "model_discovery_unsupported", "model_validation_unsupported", "model_required",
  "model_unavailable", "configuration_invalid", "connection_unavailable", "connection_revision_conflict",
  "connection_configuration_immutable", "connection_type_change_incompatible", "credential_source_invalid",
  "authentication_lifecycle_unsupported", "delegated_account_disconnect_required", "oauth_binding_changed",
  "oauth_state_invalid", "advisor_read_only_required", "advisor_provider_incompatible",
  "vault_secret_exists", "vault_secret_unavailable", "vault_credential_empty", "vault_credential_too_large",
  "vault_persistence_failed", "mcp_policy_unverified", "mcp_policy_conflict", "mcp_policy_tool_unavailable",
  "knowledge_conflict", "knowledge_invalid", "knowledge_library_limit", "knowledge_proposal_not_found",
  "knowledge_publish_uncertain", "knowledge_review_required", "knowledge_secret_rejected", "knowledge_too_large",
  "knowledge_unavailable",
  ...Object.keys(runtimeControlOperationErrors) as RuntimeControlOperationError[],
]);
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
  "create", "hasCredential", "replace", "delete", "recover",
  "currentMcpServerCredentialBinding", "ensureMcpServerCredentialBinding", "rotateMcpServerCredential",
  "replaceMcpServerCredentialBinding", "restoreMcpServerCredentialBinding",
  "revokeMcpServerCredentialBinding", "createSecurityProfileCredentialBinding", "recoverSecurityProfileCredentialBinding",
  "rotateSecurityProfileCredential", "replaceSecurityProfileCredentialBinding", "currentSecurityProfileCredentialBinding",
  "revokeSecurityProfileCredentialBinding",
] as const;

const runId = z.string().uuid();
const actor = z.string().min(1).max(64).regex(/^[a-zA-Z0-9-]+$/);
const publicationInput = z.object({
  runId, stepId: z.string().min(1).max(128), title: z.string().trim().min(1).max(256),
  body: z.string().max(65_536), draft: z.boolean(),
});
export const policyOperations = ["head","attestation","verify","verifyFrozen","begin","publish","settle","inspect"] as const;
export const workIqOperations = ["begin","lookup","discard","complete","checkConfiguration","updateClientSecret","disconnect"] as const;
export const knowledgeOperations = ["get","list","save","review","claim","finish"] as const;

export const runnerOperations = ["capabilities","managedRepository","environments","workspaceDiagnostics","sandboxDiagnostics",
 "models","authStatus","authEnvironmentDiagnostics","sqliteStorage","createSqliteBackup","restoreSqliteBackup","testCodex",
 "jobs","controlStatus","emergencyStop","resume","startDeviceAuth","logout"] as const;

const providerKey = z.string().min(1).max(120);
const providerSecretRef = z.string().regex(/^sec_[A-Za-z0-9_-]{43}$/);
const suppliedCredential = z.string().min(1).max(8192);

export const providerConnectionSnapshotSchema = z.object({
  key: providerKey, name: z.string().min(1).max(120), adapter: providerKey,
  endpoint: z.string().max(2048).optional(), defaultModel: providerKey.optional(),
  providerConfiguration: z.record(z.string(), z.string().max(2048)).optional(),
  authorizationContextId: providerKey.optional(), enabled: z.boolean(), configured: z.boolean().optional(),
  management: z.literal("git"), credentialSource: z.literal("adt-vault").optional(),
  credentialSecretRef: providerSecretRef.optional(), repositoryRevision: providerKey,
  capabilities: z.object({ asynchronous: z.boolean(), cancellation: z.boolean(),
    agentTools: z.boolean().optional(), runtimeSecurity: z.boolean().optional() }).strict(),
}).strict();

const modelInput = z.object({
  connectionType: providerKey,
  configuration: z.unknown().optional(),
  credentials: z.discriminatedUnion("source", [
    z.object({ source: z.literal("input"), credential: suppliedCredential.optional() }).strict(),
    z.object({ source: z.literal("saved"), connection: providerConnectionSnapshotSchema }).strict(),
  ]),
});

export const providerManagementSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("describe"), connections: providerConnectionSnapshotSchema.array().max(25) }).strict(),
  z.object({ action: z.literal("snapshot"), connection: providerConnectionSnapshotSchema }).strict(),
  z.object({ action: z.literal("test"), connection: providerConnectionSnapshotSchema }).strict(),
  modelInput.extend({ action: z.literal("models") }).strict(),
  modelInput.extend({ action: z.literal("validate"), model: providerKey.optional() }).strict(),
]);

export type ProviderManagementRequest = z.infer<typeof providerManagementSchema>;
export type ProviderReadiness = { enabled: boolean; configured: boolean; authorizationContextId?: string };

export const runtimeControlSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("runs.health"), repositoryId, scope: repositoryContextSchema }).strict(),
  z.object({ operation: z.literal("runs.diagnose"), repositoryId, scope: repositoryContextSchema }).strict(),
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
  z.object({ operation: z.literal("provider"), repositoryId, request: providerManagementSchema }).strict(),
  z.object({ operation: z.literal("mcp.discover"), repositoryId, definition: z.unknown() }).strict(),
  z.object({ operation: z.literal("security.test"), repositoryId, definition: z.unknown() }).strict(),
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
