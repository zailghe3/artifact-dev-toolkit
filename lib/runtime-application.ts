import { PostgresWorkflowDatabase } from "../adt-runtime/src/workflow-database.ts";
import { recordManagementNonce } from "../adt-runtime/src/operational-settings.ts";
import { AUTH_WINDOW_MS } from "../adt-runtime/src/protocol.ts";
import type { Pool } from "../adt-runtime/src/postgres.ts";
import type { RuntimeRootKey } from "../adt-runtime/src/runtime-key.ts";
import { managedContextSchema, repositoryContextSchema, type RuntimeControlCommand } from "../adt-runtime/src/runtime-control-contract.ts";
import { CONVERSATION_RUN_KEY_PREFIX, conversationRunKey } from "../adt-runtime/src/conversation-contract.ts";
import { ConversationStore } from "./conversation-store.ts";
import { conversationContextSettings, planConversationContext } from "./conversation-context.ts";
import { summarizeConversation } from "./conversation-summaries.ts";
import { WorkflowResponseActions, knowledgeFromWorkflowAction } from "./workflow-response-actions.ts";
import { WorkflowRunContent } from "./workflow-run-content.ts";
import { workflowRunActivity } from "./workflow-run-activity.ts";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";
import { WorkflowInteractions } from "./workflow-interactions.ts";
import { usesInteractiveBlocks, WORKFLOW_INTERACTION_VERSION } from "../adt-runtime/src/workflow-interaction-contract.ts";
import { assertInteractivePlanTopology, genericWorkflowExecutionPlanSchema } from "./workflow-definitions.ts";
import { D1ProviderCredentialVault } from "./provider-credential-vault.ts";
import { AgentJournal } from "./agent-journal.ts";
import { operateRuntimeTools } from "./runtime-tool-decisions.ts";
import { hasToolRole } from "./agent-tool-roles.ts";
import { GitHubToolDefinitionRepository } from "./tool-definition-repository.ts";
import { D1McpPolicyAuthority } from "./mcp-policy-authority.ts";
import { isLegacyRunReadOnly } from "./workflow-run-legacy.ts";
import { manualRetryEligibility, type RunRepositoryContext, type WorkflowRun } from "./workflow-storage.ts";
import { assertPublicationPolicy, assertRunExecutionPolicy, assertWorkflowPolicyCommissioned, sameRepositoryContext } from "./workflow-execution-policy.ts";
import { requestRepositoryCredential } from "./runtime-service-client.ts";
import { createWorkflowCoordinator } from "./runtime-workflow-execution.ts";
import { mcpServerDefinitionSchema } from "./tool-definitions.ts";
import type { PolicyHead } from "./mcp-policy-authority.ts";
import { beginWorkIqOAuth, completeWorkIqOAuth, WorkIqOAuthStateStore } from "./work-iq-oauth.ts";
import { KnowledgeProposalStore } from "./advisor-knowledge-proposals.ts";
import { CodexRunnerError, getCodexRunnerClient } from "./codex-runner-client.ts";
import { managedPublicationTaskId, publishManagedPullRequest } from "./managed-pull-request-publication.ts";

import { manageProviderConnection, providerDiagnosticFailure } from "./runtime-provider-management.ts";
import { RemoteOpenAIAgentsRuntime, RemoteRuntimeFailure } from "./adt-runtime-client.ts";
import { ProviderModelService } from "./provider-model-service.ts";
import { listOpenAIModels, validateOpenAIModel } from "./openai-models.ts";
import { listAnthropicModels, validateAnthropicModel } from "./anthropic-models.ts";
import { createWorkflowAdapterRegistry } from "./agent-runtime.ts";
import { securityProfileDefinitionSchema } from "./security-profile-definitions.ts";
import { assertWorkIqConfigurationMutable, parseWorkIqPrivateBundle, serializeWorkIqPrivateBundle, createWorkIqPrivateBundle } from "./work-iq-auth.ts";
import { z } from "zod";

export type RuntimeApplicationOptions = {
  pool: Pool;
  rootKey: RuntimeRootKey;
  activeKeyVersion: number;
  env: Record<string, string | undefined>;
  onError?(stage: string): void;
  providerFetcher?: typeof fetch;
};

export function createRuntimeApplication(options: RuntimeApplicationOptions) {
  const { pool, rootKey, activeKeyVersion, env } = options;
  const db = new PostgresWorkflowDatabase(pool);
  const service = { base: env.ADT_RUNTIME_WORKER_URL, authSecret: env.ADT_RUNTIME_AUTH_SECRET };
  const credential = (context: RunRepositoryContext) => requestRepositoryCredential(service, { purpose: "artifacts", context });
  const vaultFor = (database: WorkflowD1Database, repositoryId: number) =>
    new D1ProviderCredentialVault(database, version => rootKey.vaultKey(repositoryId, version), activeKeyVersion, undefined, undefined, repositoryId);
  async function managedCredential(run: WorkflowRun, stepId: string, capability: "write" | "pull_requests") {
    assertPublicationPolicy(run);
    const plan = run.executionPlan;
    const node = plan && "planVersion" in plan ? plan.nodes.find(value => value.id === stepId) : undefined;
    if (node?.blockType !== "agent" || !run.repositoryContext) throw new Error("permission_denied");
    const context = run.managedCodeRepositoryContexts?.[node.config.agentId];
    if (!context) throw new Error("permission_denied");
    const record = await db.prepare("SELECT authority FROM managed_repository_authorities WHERE run_id=? AND agent_id=?")
      .bind(run.id, node.config.agentId).first<{ authority: string }>();
    if (!record) throw new Error("permission_denied");
    return requestRepositoryCredential(service, {
      purpose: "publication", scope: run.repositoryContext, runId: run.id, context, capability, authority: record.authority,
    });
  }

  function toolRepository(context: RunRepositoryContext) {
    return new GitHubToolDefinitionRepository(async path => {
      const token = await credential(context);
      const url = new URL(`https://api.github.com/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repository)}${path}`);
      url.searchParams.set("ref", context.branch);
      return fetch(url, {
        headers: { authorization: `Bearer ${token.token}`, accept: "application/vnd.github+json", "user-agent": "artifact-dev-toolkit" },
        redirect: "error",
      });
    });
  }

  const providerRuntime = new RemoteOpenAIAgentsRuntime({ baseUrl: env.ADT_RUNTIME_BASE_URL, authSecret: env.ADT_RUNTIME_AUTH_SECRET,
    wrappingPublicKey: env.ADT_RUNTIME_WRAPPING_PUBLIC_KEY });
  const models = new ProviderModelService({
    listRuntimeModels: (configuration, credential) => providerRuntime.discoverProviderModels(configuration, credential),
    listOpenAIModels: credential => listOpenAIModels(credential, options.providerFetcher),
    validateOpenAIModel: (credential, model) => validateOpenAIModel(credential, model, options.providerFetcher),
    listAnthropicModels: (credential, configuration) => listAnthropicModels(credential, configuration, options.providerFetcher),
    validateAnthropicModel: (credential, model, configuration) => validateAnthropicModel(credential, model, configuration, options.providerFetcher),
  });
  const coordinator = createWorkflowCoordinator({ pool, env, vaultFor, credential, managedCredential, onError: options.onError });
  async function store(command: RuntimeControlCommand) {
    if(command.operation==="broker.claim"){
      if(Math.abs(Date.now()-command.timestamp)>AUTH_WINDOW_MS)return false;
      return recordManagementNonce(pool,`broker:${command.nonce}`,command.timestamp);
    }
    if(command.operation==="runner.release")return getCodexRunnerClient(env).capabilities();
    if(command.operation==="runner"){
      try{
        const runner=getCodexRunnerClient(env);
        const result=await Reflect.apply(runner[command.method],runner,command.arguments);
        return {ok:true,result};
      }catch(error){
        if(error instanceof CodexRunnerError)return {ok:false,failure:{category:error.category,transport:error.transport,
          runnerCode:error.runnerCode,details:error.details}};
        throw error;
      }
    }
    const storage = new D1WorkflowRunStorage(db, undefined, command.repositoryId);
    const approvals = new WorkflowInteractions(db);
    const journal = new AgentJournal(db, undefined, env);
    const vault = vaultFor(db, command.repositoryId);
    if ("scope" in command && command.scope.repositoryId !== command.repositoryId) throw new Error("permission_denied");
    switch (command.operation) {
      case "conversations.prepare": {
        const prepared = await new ConversationStore(db, command.scope).prepare(command.submission);
        return prepared.replay ?? null;
      }
      case "conversations.list":
        return new ConversationStore(db, command.scope).list(command.query, command.target, command.before);
      case "conversations.detail":
        return new ConversationStore(db, command.scope).detail(command.id, command.before);
      case "conversations.rename":
        return new ConversationStore(db, command.scope).rename(command.id, command.title);
      case "vault": {
        // The allowlist is defined in the wire schema. Vault methods also check object identity and repository ownership.
        const method = vault[command.method] as (...parameters: unknown[]) => Promise<unknown>;
        return await Reflect.apply(method, vault, command.arguments) ?? null;
      }
      case "provider":
        return manageProviderConnection(command.request, vault, models, () => createWorkflowAdapterRegistry(options.providerFetcher));
      case "mcp.discover": {
        const definition = mcpServerDefinitionSchema.parse(command.definition);
        let credential: string | undefined;
        if (definition.authentication.mode === "bearer") {
          const ref = definition.authentication.credentialSecretRef;
          const binding = await vault.currentMcpServerCredentialBinding(command.repositoryId, definition.id, definition.endpointUrl, ref);
          credential = await vault.resolveMcpServerCredential(command.repositoryId, binding, ref);
        }
        const result = await providerRuntime.discoverMcp({ url: definition.endpointUrl, transport: "streamable-http" }, credential);
        if (credential && JSON.stringify(result).includes(JSON.stringify(credential).slice(1,-1))) throw new Error("malformed_response");
        return result;
      }
      case "security.test": {
        const definition = securityProfileDefinitionSchema.parse(command.definition);
        const binding = await vault.currentSecurityProfileCredentialBinding(command.repositoryId, definition.id, definition.endpointUrl);
        const credential = await vault.resolveSecurityProfileCredential(command.repositoryId, binding.bindingId, definition.endpointUrl);
        try { return { ok: true, result: await providerRuntime.testSecurityProfile(definition, credential) }; }
        catch (error) {
          if (error instanceof RemoteRuntimeFailure) return { ok: false, failure: providerDiagnosticFailure(error) };
          throw error;
        }
      }
      case "policy": {
        const authority=new D1McpPolicyAuthority(db),[first,second,third,fourth]=command.arguments;
        const repositoryId=command.repositoryId;
        switch(command.method){
          case "head":return await authority.head(repositoryId,String(first))??null;
          case "attestation":{
            const record=await authority.attestation(String(first));
            return record?.repository_id===repositoryId?record:null;
          }
          case "inspect":return authority.inspect(repositoryId,mcpServerDefinitionSchema.parse(first),vault);
          case "verify":return authority.verify(repositoryId,mcpServerDefinitionSchema.parse(first),vault);
          case "verifyFrozen":return authority.verifyFrozen(repositoryId,first as Parameters<typeof authority.verifyFrozen>[1],second as Awaited<ReturnType<typeof authority.verify>>);
          case "begin":return authority.begin(repositoryId,String(first),second as PolicyHead|undefined,third===true);
          case "settle":return authority.settle(repositoryId,String(first),String(second),third as PolicyHead|undefined,fourth===true);
          case "publish":return authority.publish(repositoryId,mcpServerDefinitionSchema.parse(first),vault,{actor:String(second),environment:env,authority},String(third));
        }
        break;
      }
      case "work-iq": {
        const state=new WorkIqOAuthStateStore(db,command.repositoryId),[first,second]=command.arguments;
        switch(command.method){
          case "begin":return (await beginWorkIqOAuth(first as Parameters<typeof beginWorkIqOAuth>[0],state,vault)).href;
          case "lookup":return {connectionKey:(await state.lookup(String(first),String(second))).connection_key};
          case "discard":await state.discard(String(first),String(second),vault);return null;
          case "checkConfiguration":await assertWorkIqConfigurationMutable(String(first),vault);return null;
          case "updateClientSecret":
          case "disconnect": {
            const ref=z.string().min(1).max(48).parse(first);
            const current=await vault.resolveWithRevision(ref);
            const bundle=parseWorkIqPrivateBundle(current.value);
            const value=command.method==="disconnect"?createWorkIqPrivateBundle(bundle.clientSecret):
              serializeWorkIqPrivateBundle({...bundle,clientSecret:z.string().trim().min(1).max(8192).parse(second)});
            if(!await vault.replaceIfRevision(ref,current.revision,value))throw new Error("connection_revision_conflict");
            return null;
          }
          case "complete":await completeWorkIqOAuth(first as Parameters<typeof completeWorkIqOAuth>[0],state,vault);return null;
        }
        break;
      }
      case "knowledge": {
        if(command.scope.repositoryId!==command.repositoryId)throw Error("permission_denied");
        const knowledge=new KnowledgeProposalStore(db,command.scope,command.actor);
        const [id,revision,token]=command.arguments;
        switch(command.method){
          case "list":return knowledge.list();
          case "get":return knowledge.get(String(id));
          case "save":return knowledge.save(id as Parameters<typeof knowledge.save>[0]);
          case "review":return knowledge.review(String(id),Number(revision));
          case "claim":return knowledge.claimPublication(String(id),Number(revision),String(token));
          case "finish":return knowledge.finishPublication(String(id),revision as Parameters<typeof knowledge.finishPublication>[1]);
        }
        break;
      }
      case "runs.diagnose": {
        if(command.scope.repositoryId!==command.repositoryId)throw Error("permission_denied");
        const probe = async (read: () => Promise<unknown>, storage = false) => {
          const started = Date.now();
          try {
            await read();
            return { status: "available", elapsedMs: Date.now() - started };
          } catch {
            return { status: "unavailable", elapsedMs: Date.now() - started,
              ...(storage ? { result: "storage_query_unavailable" } : {}) };
          }
        };
        const [postgres, checkpoints, broker] = await Promise.all([
          probe(() => pool.query("SELECT 1"), true),
          probe(() => pool.query(`SELECT 1 FROM langgraph_checkpoints AS checkpoint
            JOIN workflow_runs AS run ON run.id = checkpoint.run_id WHERE run.repository_id = $1 LIMIT 1`,
            [command.repositoryId]), true),
          probe(() => requestRepositoryCredential(service, { purpose: "artifacts", context: command.scope }, 4_000)),
        ]);
        // The Worker verifies history through the ordinary runs.list response.
        return { postgres, checkpoints, workflow: { status: "not_verified" }, broker };
      }
      case "runs.health": {
        if(command.scope.repositoryId!==command.repositoryId)throw Error("permission_denied");
        const check=await pool.query("SELECT to_regclass('langgraph_checkpoints') AS checkpoint, to_regclass('workflow_runs') AS workflow");
        const broker=await credential(command.scope).then(()=>true,()=>false);
        return {checkpoint:Boolean(check.rows[0]?.checkpoint),workflow:Boolean(check.rows[0]?.workflow),broker};
      }
      case "runs.list": return storage.listRuns(command.limit);
      case "runs.find": return await storage.findRunByIdempotencyKey(command.key) ?? null;
      case "runs.interaction":
      case "runs.content":
      case "runs.outputs":
      case "runs.activity":
      case "runs.display": {
        const row = await db.prepare("SELECT repository_context_json FROM workflow_runs WHERE id=? AND repository_id=?")
          .bind(command.runId, command.repositoryId).first<{ repository_context_json: string }>();
        if (!row || !sameRepositoryContext(repositoryContextSchema.parse(JSON.parse(row.repository_context_json)), command.scope))
          throw new Error("run_not_found");
        if (command.operation === "runs.activity") return workflowRunActivity(db, command.runId, command.before);
        const content = new WorkflowRunContent(db);
        if (command.operation === "runs.content") return content.page(command.runId, command.before);
        if (command.operation === "runs.outputs") return content.outputs(command.runId);
        if (command.operation === "runs.display") return content.display(command.runId, command.activationId);
        const { requestId, submission } = command;
        if (!submission) return approvals.read(command.runId, requestId);
        const accepted = await approvals.respond(command.runId, requestId, submission.actor, submission.response);
        if (!accepted.consumedAt) await coordinator.wake(command.runId);
        return accepted;
      }
      case "runs.launch": {
        const run = command.snapshot as unknown as WorkflowRun;
        const context = repositoryContextSchema.parse(run.repositoryContext);
        if (context.repositoryId !== command.repositoryId || !/^[a-f0-9-]{36}$/.test(run.id) ||
          run.workflowGeneration !== 1 || run.status !== "queued" || isLegacyRunReadOnly(run)) throw new Error("invalid_run_snapshot");
        assertWorkflowPolicyCommissioned(run);
        assertRunExecutionPolicy(run);
        if (run.executionPlan && "planVersion" in run.executionPlan && usesInteractiveBlocks(run.executionPlan)) {
          if (command.interactionVersion !== WORKFLOW_INTERACTION_VERSION) throw new Error("invalid_run_snapshot");
          assertInteractivePlanTopology(genericWorkflowExecutionPlanSchema.parse(run.executionPlan));
        }
        const managed = Object.entries(run.managedCodeRepositoryContexts ?? {});
        const authorities = command.publicationAuthorities ?? {};
        if (managed.length !== Object.keys(authorities).length || managed.some(([agentId, value]) =>
          !managedContextSchema.safeParse(value).success || !Object.hasOwn(authorities, agentId))) throw new Error("invalid_run_snapshot");
        const submission = command.conversation;
        const conversations = new ConversationStore(db, context);
        let assembled: ReturnType<ReturnType<typeof planConversationContext>["assemble"]> | undefined;
        if (submission) {
          const plan = run.executionPlan;
          const entry = plan && "planVersion" in plan ? plan.nodes[0] : undefined;
          const matchesTarget = submission.target.kind === "workflow" ? run.workflowId === submission.target.id
            : entry?.blockType === "agent" && entry.config.agentId === submission.target.id && plan?.nodes.length === 1;
          if (!matchesTarget || run.initialInput !== submission.message || run.clientIdempotencyKey !== conversationRunKey(submission) || run.advisorContext) {
            throw new Error("invalid_run_snapshot");
          }
          const prepared = await conversations.prepare(submission);
          if (prepared.replay) return prepared.replay;
          const history = await conversations.history(submission.conversationId, prepared.head, submission.exactTurnIds);
          const contextPlan = planConversationContext({ ...history, turnId: submission.turnId, message: submission.message, exactTurnIds: submission.exactTurnIds,
            settings: conversationContextSettings(env) });
          const summary = await summarizeConversation(db, run, submission, contextPlan.providerInput, contextPlan.summaryLimit, vault, env, options.providerFetcher);
          assembled = contextPlan.assemble(summary);
          run.initialInput = assembled.initialInput;
        } else if (run.clientIdempotencyKey?.startsWith(CONVERSATION_RUN_KEY_PREFIX)) {
          throw new Error("workflow_idempotency_conflict");
        }
        return db.transaction(async database => {
          const scoped = new D1WorkflowRunStorage(database, undefined, command.repositoryId);
          const conversationStore = new ConversationStore(database, context);
          const prepared = submission && await conversationStore.prepare(submission);
          if (prepared?.replay) return prepared.replay;
          const saved = await scoped.createRun(run);
          if (!sameRepositoryContext(saved.run.repositoryContext, context) || saved.run.workflowId !== run.workflowId ||
              saved.run.initialInput !== run.initialInput || Boolean(saved.run.advisorContext) !== Boolean(run.advisorContext) ||
              saved.run.executionPolicy !== run.executionPolicy || submission && saved.run.id !== run.id) {
            throw new Error("workflow_idempotency_conflict");
          }
          if (saved.run.id === run.id) {
            for (const [agentId] of managed) {
              await database.prepare("INSERT INTO managed_repository_authorities(run_id,agent_id,authority) VALUES(?,?,?) ON CONFLICT DO NOTHING")
                .bind(run.id, agentId, authorities[agentId]).run();
            }
          }
          if (submission && prepared && assembled) {
            await conversationStore.append(submission, saved.run, (prepared.head?.ordinal ?? 0) + 1, assembled.metadata);
            return { conversationId: submission.conversationId, turnId: submission.turnId, runId: saved.run.id, replay: false };
          }
          return saved;
        });
      }
    }

    if(!("runId" in command))throw Error("invalid_request");
    const detail = await storage.getRun(command.runId);
    if (!detail) {
      if (command.operation === "runs.detail") return null;
      throw new Error("run_not_found");
    }
    const { run } = detail;
    const context = run.repositoryContext;
    if (command.operation === "runs.detail") {
      const conversation = context && await new ConversationStore(db, context).link(run.id);
      const content = run.executionPlan && "planVersion" in run.executionPlan && usesInteractiveBlocks(run.executionPlan)
        ? await new WorkflowRunContent(db).page(run.id) : undefined;
      return { ...detail, ...(conversation ? { conversation } : {}), ...(content ? { content } : {}) };
    }
    if (!context || isLegacyRunReadOnly(run)) throw new Error("legacy_run_read_only");
    assertRunExecutionPolicy(run);
    switch (command.operation) {
      case "runs.action":
      case "knowledge.from-action": {
        if (!sameRepositoryContext(context, command.scope)) throw new Error("workflow_action_not_found");
        const action = await new WorkflowResponseActions(db).require(detail, command.actionId);
        if (command.operation === "runs.action") return { markdown: action.content };
        return new KnowledgeProposalStore(db, context, command.actor).saveFromAction(action.id, knowledgeFromWorkflowAction(run, action));
      }
      case "runs.cancel": {
        const status = await storage.requestCancellation(run.id);
        await coordinator.wake(run.id);
        return status;
      }
      case "runs.retry": {
        const next = await db.transaction(async database => {
          const scoped = new D1WorkflowRunStorage(database, undefined, command.repositoryId);
          const link = await new ConversationStore(database, context).link(run.id);
          if (link && !link.isLatest) throw new Error("conversation_retry_superseded");
          const eligibility = manualRetryEligibility(await scoped.getRun(run.id));
          if (!eligibility.eligible) throw new Error("invalid_retry");
          return scoped.prepareManualRetry(run.id, eligibility.stepId);
        });
        await coordinator.wake(run.id);
        return next;
      }
      case "runs.approval": {
        const result = await approvals.approve(run.id, command.approvalRequestId);
        await coordinator.wake(run.id);
        return result;
      }
      case "runs.inspection": {
        const operator = hasToolRole(command.actor, "operator", env);
        return { approval: await approvals.active(run.id) ?? null, tools: await journal.inspect(run.id, operator, command.actor), operator };
      }
      case "runs.tools":
        return operateRuntimeTools({ ...command, journal, repository: toolRepository(context),
          policies: new D1McpPolicyAuthority(db), vault, env, wake: coordinator.wake });
      case "runs.publish": {
        assertPublicationPolicy(run);
        const runner = { baseUrl: env.CODEX_RUNNER_BASE_URL!, accessClientId: env.CODEX_RUNNER_ACCESS_CLIENT_ID!,
          accessClientSecret: env.CODEX_RUNNER_ACCESS_CLIENT_SECRET!, sharedSecret: env.CODEX_RUNNER_SHARED_SECRET! };
        const attempt=detail.attempts.filter(value=>value.stepId===command.stepId&&value.status==="succeeded").at(-1);
        if(!attempt)throw new Error("managed_codex_result_required");
        const taskId=await managedPublicationTaskId(run.id,command.stepId,attempt.iteration);
        const key=[run.id,command.stepId,taskId];
        const requestDigest=Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(
          JSON.stringify([command.title,command.body,command.draft])))).toString("hex");
        const existing=await pool.query<{request_digest:string;result:unknown}>(
          "SELECT request_digest,result FROM manual_workflow_publications WHERE run_id=$1 AND step_id=$2 AND repository_task_id=$3",key);
        if(existing.rows[0]){
          if(existing.rows[0].request_digest!==requestDigest)throw new Error("managed_publication_conflict");
          if(!existing.rows[0].result)throw new Error("provider_publish_ambiguous");
          return existing.rows[0].result;
        }
        const result=await publishManagedPullRequest({
          ...command, detail, database: db, runner, credentialProvider: capability => managedCredential(run, command.stepId, capability),
          beforeDispatch:async()=>{
            const claim=await pool.query(`INSERT INTO manual_workflow_publications (run_id,step_id,repository_task_id,request_digest)
              SELECT id,$2,$3,$4 FROM workflow_runs WHERE id=$1 AND cancel_requested_at IS NULL
              ON CONFLICT DO NOTHING`,[...key,requestDigest]);
            if(claim.rowCount!==1)throw new Error("managed_publication_conflict");
          },
          access: { ok: true, owner: context.owner, repo: context.repository, repositoryId: context.repositoryId,
            installationId: context.installationId, githubId: 0, login: "runtime", checkedAt: Date.now(),
            installationCredentialProvider: () => credential(context) },
        });
        await pool.query(`UPDATE manual_workflow_publications SET result=$4
          WHERE run_id=$1 AND step_id=$2 AND repository_task_id=$3`,[...key,JSON.stringify(result)]);
        return result;
      }
    }
  }

  return { store, start: coordinator.start, stop: coordinator.stop };
}
