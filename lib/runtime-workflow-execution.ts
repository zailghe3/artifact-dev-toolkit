import type { Pool } from "../adt-runtime/src/postgres.ts";
import { advanceGenericGraph, type GraphExecutionRequest } from "../adt-runtime/src/langgraph.ts";
import { PostgresWorkflowDatabase } from "../adt-runtime/src/workflow-database.ts";
import { workflowLeases, WORKFLOW_HEARTBEAT_MS, WorkflowLeaseLost, type WorkflowLease } from "../adt-runtime/src/workflow-leases.ts";
import { D1WorkflowRunStorage, type WorkflowD1Database } from "./workflow-d1-storage.ts";
import { D1LangGraphCheckpointStore, type GraphNodeAuthorityScope } from "./langgraph-checkpoints.ts";
import { type LangGraphAdvanceRequest } from "./adt-runtime-client.ts";
import { projectExecutionPlanForRuntime } from "./workflow-definitions.ts";
import { type D1ProviderCredentialVault } from "./provider-credential-vault.ts";
import { type RunRepositoryContext, type WorkflowRun } from "./workflow-storage.ts";
import { D1WorkflowApprovalStore } from "./workflow-approvals.ts";
import { AgentJournal } from "./agent-journal.ts";
import { checkAgentToolWait } from "./agent-tool-wait.ts";
import { cancelRuntimeWorkflow, executeWorkflowGraphNode,type WorkflowExecutionEnvironment } from "./workflow-worker-runtime.ts";
import { MAX_WORKFLOW_RUN_MS } from "./workflow-durable-driver.ts";
import type { RepositoryCredential } from "./github-app.ts";
import { WorkflowResponseActions } from "./workflow-response-actions.ts";
import { assertRunExecutionPolicy } from "./workflow-execution-policy.ts";
import type { GraphKnowledgeOutput } from "../adt-runtime/src/langgraph.ts";

const active = new Set(["queued", "running", "waiting_approval", "cancelling"]);
const localAuthority = "runtime-in-process-checkpoint-authority";
const localGraphUrl = "http://127.0.0.1/";
const pendingDelay = 1_000;
const waitDelay = 15_000;
const retryLimit = 6;
const maxConcurrentRuns = 3;

export type WorkflowExecutionOptions = {
  pool: Pool;
  env: WorkflowExecutionEnvironment;
  vaultFor(database: WorkflowD1Database, repositoryId: number): D1ProviderCredentialVault;
  credential(context: RunRepositoryContext): Promise<RepositoryCredential>;
  managedCredential(run: WorkflowRun, stepId: string, capability: "write" | "pull_requests"): Promise<RepositoryCredential>;
  onError?(stage: string): void;
};

export function createWorkflowCoordinator(options: WorkflowExecutionOptions) {
  const leases = workflowLeases(options.pool);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tick: Promise<void> | undefined;
  const running = new Set<Promise<void>>();

  async function advance(lease: WorkflowLease) {
    const database = new PostgresWorkflowDatabase(options.pool, client => leases.guard(client, lease));
    const storage = new D1WorkflowRunStorage(database);
    const journal = new AgentJournal(database);
    const approvals = new D1WorkflowApprovalStore(database);
    const detail = await storage.getRun(lease.id);
    if (!detail || !active.has(detail.run.status) || detail.run.workflowGeneration !== lease.generation) return 0;
    const { run } = detail;
    assertRunExecutionPolicy(run);

    if (run.cancelRequestedAt || run.status === "cancelling") {
      await journal.cancelPending(run.id);
      if (!run.repositoryContext) throw new Error("invalid_run_snapshot");
      const outcome = await cancelRuntimeWorkflow(options.env, detail, storage, options.vaultFor(database, run.repositoryContext.repositoryId));
      return outcome === "cancellation_pending" ? 5_000 : 0;
    }
    const suspended = await approvals.suspendedMs(run.id) + await journal.suspendedMs(run.id);
    if (Date.now() - Date.parse(run.createdAt) - suspended > MAX_WORKFLOW_RUN_MS) {
      await storage.failRun(run.id, "provider_timeout", "The workflow run exceeded its time limit.");
      return 0;
    }
    const waiting = await checkAgentToolWait({ runId: run.id, db: database, storage });
    if (waiting) return Math.min(waitDelay, waiting.seconds * 1_000);
    if (!run.executionPlan || !("planVersion" in run.executionPlan) || !run.repositoryContext) throw new Error("invalid_run_snapshot");
    const plan = projectExecutionPlanForRuntime(run.executionPlan);
    const actions = new WorkflowResponseActions(database);
    const recordKnowledge = (output: GraphKnowledgeOutput) => actions.record(run, output);
    const checkpoints = new D1LangGraphCheckpointStore(database);
    const vault = options.vaultFor(database, run.repositoryContext.repositoryId);
    const execute: typeof fetch = async (url, init) => {
      const payload: unknown = JSON.parse(String(init?.body));
      if (String(url) === localGraphUrl + "checkpoint") {
        const result = await checkpoints.execute(run.id, payload as Parameters<typeof checkpoints.execute>[1]);
        return Response.json({ ok: true, result });
      }
      if (String(url) !== localGraphUrl + "agent") throw new Error("invalid_graph_endpoint");
      const { inputText, ...scope } = payload as GraphNodeAuthorityScope & { inputText: string };
      const result = await executeWorkflowGraphNode(options.env, scope, inputText, {
        database, vault, repositoryCredential: options.credential, managedCredential: options.managedCredential,
      });
      return Response.json(result, { status: result.state === "failed" ? 422 : 200 });
    };
    const request: GraphExecutionRequest = {
      protocolVersion: "adt-runtime-v1", capability: "langgraph:graph", requestId: run.id,
      runId: run.id, initialInput: run.initialInput, plan: plan as GraphExecutionRequest["plan"],
      checkpointGateway: { url: localGraphUrl + "checkpoint", authority: localAuthority },
      nodeGateway: { url: localGraphUrl + "agent" },
    };
    let result = await advanceGenericGraph(request, execute, recordKnowledge);
    if (result.state === "approval_required") {
      const approval = await approvals.require({
        runId: run.id, workflowGeneration: lease.generation, nodeId: result.nodeId!,
        activationId: result.activationId!, interruptId: result.interruptId!, message: result.message!, reviewText: result.text!,
      });
      if (approval.status !== "approved") return waitDelay;
      if (!approval.consumedAt && !await approvals.consume(run.id, approval.requestId)) return pendingDelay;
      request.approvalResume = { requestId: approval.requestId, interruptId: approval.interruptId, approved: true };
      result = await advanceGenericGraph(request, execute, recordKnowledge);
    }
    if (result.state === "admission_required") {
      const authorities: Extract<LangGraphAdvanceRequest["nodeGateway"], { authorities: unknown }>["authorities"] = [];
      for (const activation of result.frontier) {
        const attempt = await storage.ensureGraphActivation(run.id, activation.nodeId, activation.activationId);
        authorities.push({ ...activation, workflowGeneration: lease.generation, iteration: attempt.iteration, attempt: attempt.attempt, authority: localAuthority });
      }
      result = await advanceGenericGraph({ ...request, nodeGateway: { url: localGraphUrl + "agent", authorities } }, execute, recordKnowledge);
    }
    if (result.state === "completed") {
      const latest = await storage.getRun(run.id);
      if (!latest) throw new Error("workflow_output_unverified");
      const terminal = plan.nodes.find(node => node.id === plan.terminalNodeId);
      const attempt = latest.attempts.filter(item => item.stepId === plan.terminalNodeId && item.status === "succeeded").at(-1);
      const output = terminal?.blockType === "knowledge-proposal"
        ? await actions.terminalOutput(latest, plan.terminalNodeId, result.terminalActivationId, result.outputText)
        : { text: attempt?.outputText, url: attempt?.outputExternalUrl, actionId: undefined };
      if (output.text === undefined || output.text !== result.outputText) throw new Error("workflow_output_unverified");
      await database.transaction(async db => {
        await new D1WorkflowRunStorage(db).completeRun(run.id, plan.terminalNodeId, result.outputText, output.url, output.actionId);
        if (plan.nodes.some(node => node.blockType === "knowledge-proposal")) {
          await new WorkflowResponseActions(db).publish(run.id, output.actionId);
        }
      });
      return 0;
    }
    if (result.state === "failed") {
      const finished = await storage.finalizeGraphFailure(run.id, lease.generation);
      return finished ? 0 : pendingDelay;
    }
    if (result.state === "graph_failure" || result.state === "execution_limit") {
      await storage.failRun(run.id, "failureCode" in result && result.failureCode || "internal_error", result.safeMessage ?? "Workflow graph execution failed.");
      return 0;
    }
    if (result.state === "pending") return result.retryAfterMs ?? pendingDelay;
    if (result.state === "approval_required") return 0; // Persist the new approval on the next turn.
    return 0;
  }

  async function process(lease: WorkflowLease) {
    const heartbeat = setInterval(() => {
      void leases.renew(lease).catch(() => options.onError?.("renew"));
    }, WORKFLOW_HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      const delay = await advance(lease);
      await leases.release(lease, delay);
    } catch (error) {
      if (error instanceof WorkflowLeaseLost) return;
      const count = lease.failures + 1;
      if (count > retryLimit) {
        const storage = new D1WorkflowRunStorage(new PostgresWorkflowDatabase(options.pool, client => leases.guard(client, lease)));
        await storage.failRun(lease.id, "internal_error", "The Runtime could not recover this workflow.", undefined, lease.generation);
      }
      await leases.release(lease, Math.min(30_000, 1_000 * 2 ** count), count);
      options.onError?.("progression");
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function poll() {
    for (let slot = running.size; slot < maxConcurrentRuns && !stopped; slot++) {
      const lease = await leases.claim();
      if (!lease) return;
      const job = process(lease).catch(() => options.onError?.("lease")).finally(() => running.delete(job));
      running.add(job);
    }
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      tick = poll().catch(() => options.onError?.("poll")).finally(schedule);
    }, 250);
    timer.unref?.();
  }

  return {
    start: schedule,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await tick;
      await Promise.allSettled([...running]);
    },
    wake: leases.wake,
  };
}
