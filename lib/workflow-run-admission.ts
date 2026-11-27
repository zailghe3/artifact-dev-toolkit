import { NextResponse } from "next/server";
import { conversationRunKey, type ConversationSubmission, type ConversationTarget } from "../adt-runtime/src/conversation-contract.ts";
import type { RepositoryAccessContext } from "./repository-authorization.ts";
import { DEFAULT_ARTIFACT_ROOT } from "./artifact-contract.ts";
import { assertReadOnlyExecution, assertRunExecutionPolicy, requiredExecutionPolicy, sameRepositoryContext } from "./workflow-execution-policy.ts";
import { newLangGraphWorkflowRun, type WorkflowRun } from "./workflow-storage.ts";
import { validateWorkflowRunAdmissionSources, validateAgentConnectionOptions, workflowAgentReferences, compileWorkflowV2ExecutionPlan,
  composeVersionedWorkflowV2, workflowDefinitionSchema, AGENT_MASTER_PROMPT_MAX_LENGTH } from "./workflow-definitions.ts";
import { resolveWorkflowRunConnectionSnapshot } from "./workflow-run-connection-snapshots.ts";
import * as services from "./workflow-services.ts";
import { workflowError } from "./workflow-http.ts";
import { getArtifactWithRevision } from "./artifacts.ts";
import { freezeSecurityProfiles } from "./security-profile-authority.ts";
import { freezeAuthorizedMcpTools } from "./mcp-tool-authority.ts";
import { noStoreHeaders } from "./auth-core.ts";
import type { ConversationLaunch } from "./conversation-types.ts";

export type WorkflowStartInput = { workflowId: string; initialInput: string; idempotencyKey: string };
const defaults = { ...services, getArtifactWithRevision };
type Dependencies = Partial<typeof defaults>;

export function workflowRepositoryContext(access: RepositoryAccessContext) {
  return { repositoryId: access.repositoryId, installationId: access.installationId, owner: access.owner,
    repository: access.repo, branch: process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH ?? "main", root: DEFAULT_ARTIFACT_ROOT };
}

function assertWorkflowReplay(run: WorkflowRun, access: RepositoryAccessContext, body: WorkflowStartInput) {
  if (!sameRepositoryContext(run.repositoryContext, workflowRepositoryContext(access)) || run.initialInput !== body.initialInput ||
      run.workflowId !== body.workflowId || run.advisorContext) throw new Error("workflow_idempotency_conflict");
  assertRunExecutionPolicy(run);
}

/** Resolve current Git definitions through the same admission boundary for both target types. */
export async function resolveWorkflowRunSnapshot(access: RepositoryAccessContext, target: ConversationTarget,
  initialInput: string, idempotencyKey: string, dependencies: Dependencies = {}) {
  const service = { ...defaults, ...dependencies };
  const repo = service.createWorkflowDefinitionRepository(access);
  const allWorkflows = target.kind === "workflow" ? await repo.listWorkflows() : [];
  const single = target.kind === "agent" ? await repo.getAgent(target.id) : undefined;
  if (target.kind === "agent" && !single) throw new Error("missing_agent");
  const versioned = single ? {
    fileSha: single.fileSha,
    definition: workflowDefinitionSchema.parse({ schemaVersion: 2,
      id: `agent-${Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(target.id))).toString("hex")}`,
      name: single.definition.name, description: single.definition.description, status: "draft",
      nodes: [{ id: "respond", blockType: "agent", blockVersion: 1, config: { agentId: single.definition.id } }],
      edges: [], limits: { maxStepExecutions: 1 },
    }),
  } : allWorkflows.find(item => item.definition.id === target.id);
  if (!versioned) throw new Error("missing_workflow");

  const composed = composeVersionedWorkflowV2(versioned, allWorkflows), definition = composed.workflow;
  const versions = single ? [single] : await Promise.all([...new Set(workflowAgentReferences(definition))].map(agentId => repo.getAgent(agentId)));
  if (versions.some(item => !item)) throw new Error("missing_agent");
  const agents = versions.map(item => item!);
  const agentSnapshots = Object.fromEntries(agents.map(item => [item.definition.id, item.definition]));
  const policy = requiredExecutionPolicy({ workflowId: versioned.definition.id, semanticWorkflowSnapshot: versioned.definition,
    compositionSnapshot: composed.composition, agentSnapshots });
  const catalog = policy ? undefined : await service.readCodexRunnerCatalog(access.repositoryId);
  const identities = policy ? await service.listWorkflowConnectionIdentityDescriptors(access)
    : await service.listWorkflowConnectionDescriptors(catalog, access);
  if (policy) assertReadOnlyExecution(compileWorkflowV2ExecutionPlan(definition, Object.values(agentSnapshots)), Object.values(agentSnapshots), identities);
  const available = identities.filter(item => item.enabled);
  const plan = await validateWorkflowRunAdmissionSources(definition, Object.values(agentSnapshots), identities, new Set(available.map(item => item.key)),
    new Set((catalog?.environments ?? []).filter(item => item.enabled && item.ready && item.managedRepository === true).map(item => item.key)), Boolean(policy));
  const validated = await Promise.all(agents.map(async item => {
    const descriptor = available.find(connection => connection.key === item.definition.connectionKey)!;
    let agent = validateAgentConnectionOptions(item.definition, descriptor);
    if (agent.prompt.source === "artifact") {
      const resolved = await service.getArtifactWithRevision(access, agent.prompt.artifactId);
      if (!resolved) throw new Error("prompt_not_found");
      if (resolved.artifact.type !== "prompt") throw new Error("prompt_not_prompt_artifact");
      if (resolved.artifact.body.length > AGENT_MASTER_PROMPT_MAX_LENGTH) throw new Error("prompt_too_large");
      agent = { ...agent, masterPrompt: resolved.artifact.body };
    }
    return { ...item, definition: agent };
  }));
  const managedCodeRepositoryContexts = Object.fromEntries(await Promise.all(validated.filter(item =>
    available.find(connection => connection.key === item.definition.connectionKey)?.adapter === "codex-runner" &&
    (item.definition.adapterOptions as { managedGit?: boolean }).managedGit === true).map(async item => {
    const environmentKey = (item.definition.adapterOptions as { environmentKey: string }).environmentKey;
    return [item.definition.id, await service.resolveManagedCodeRepository(environmentKey, access.repositoryId)];
  })));
  const vault = await service.getProviderCredentialVault(access.repositoryId);
  const mcpToolSnapshots = await freezeAuthorizedMcpTools(access.repositoryId, validated.map(item => item.definition),
    service.createToolDefinitionRepository(access), vault, await service.getMcpPolicyAuthority(access.repositoryId));
  const securityProfileSnapshots = await freezeSecurityProfiles(access.repositoryId, validated.map(item => item.definition),
    service.createSecurityProfileDefinitionRepository(access), vault);
  const providerStore = await service.getWorkflowProviderConnectionStore(access);
  const connections = await Promise.all([...new Set(validated.map(item => item.definition.connectionKey))].map(key =>
    resolveWorkflowRunConnectionSnapshot(available.find(connection => connection.key === key)!, providerStore)));

  const run = newLangGraphWorkflowRun({
    id: crypto.randomUUID(), revision: versioned.fileSha, workflow: versioned.definition, compositionSnapshot: composed.composition,
    executionPlan: plan, agents: validated.map(item => item.definition),
    agentRevisions: Object.fromEntries(validated.map(item => [item.definition.id, item.fileSha])),
    connections, mcpToolSnapshots, securityProfileSnapshots, managedCodeRepositoryContexts,
    repositoryContext: workflowRepositoryContext(access), initialInput, clientIdempotencyKey: idempotencyKey, executionPolicy: policy,
  });
  assertRunExecutionPolicy(run);
  return run;
}

export async function launchWorkflowRun(access: RepositoryAccessContext, body: WorkflowStartInput, dependencies: Dependencies = {}) {
  const service = { ...defaults, ...dependencies };
  try {
    const storage = await service.getWorkflowRunStorage(access.repositoryId);
    const existing = await storage.findRunByIdempotencyKey(body.idempotencyKey);
    const detail = existing ?? await storage.createRun(await resolveWorkflowRunSnapshot(access, { kind: "workflow", id: body.workflowId },
      body.initialInput, body.idempotencyKey, dependencies));
    assertWorkflowReplay(detail.run, access, body);
    return NextResponse.json({ runId: detail.run.id, url: `/workflows/runs/${detail.run.id}`, launchState: "accepted" },
      { status: existing ? 200 : 201, headers: noStoreHeaders });
  } catch (error) {
    return workflowError(error);
  }
}

export async function launchConversationTurn(access: RepositoryAccessContext, submission: ConversationSubmission, dependencies: Dependencies = {}) {
  const service = { ...defaults, ...dependencies };
  const scope = workflowRepositoryContext(access);
  const existing = await service.workflowRuntimeCommand<ConversationLaunch | null>({
    operation: "conversations.prepare", repositoryId: scope.repositoryId, scope, submission,
  });
  if (existing) return existing;
  const run = await resolveWorkflowRunSnapshot(access, submission.target, submission.message, conversationRunKey(submission), dependencies);
  return (await service.getWorkflowRunStorage(access.repositoryId)).createConversationRun(run, submission);
}
