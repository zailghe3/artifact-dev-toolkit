// OpenNext generates this module before Wrangler bundles the custom entrypoint.
// @ts-expect-error generated build output has no source-time declaration
import nextWorker from "./.open-next/worker.js";
import { WorkflowEntrypoint } from "cloudflare:workers";

export default nextWorker;

type WorkflowEvent = { payload: { runId: string }; instanceId: string };
type WorkflowStep = { do<T>(name: string, operation: () => Promise<T>): Promise<T> };

/** Durable entrypoint. The workflow payload deliberately contains only the D1 run identifier. */
export class AgentRunWorkflow extends WorkflowEntrypoint<CloudflareEnv, { runId: string }> {
  async run(event: WorkflowEvent, step: WorkflowStep) {
    const runId = event.payload.runId;
    if (!runId || Object.keys(event.payload).length !== 1) throw new Error("invalid_workflow_payload");
    // Application runner construction is isolated behind a dynamic module so no user text
    // is returned from a durable step. Each operation reloads canonical state from D1.
    await step.do("execute-run", async () => {
      const runtime = await import("@/lib/workflow-worker-runtime");
      await runtime.executeWorkflowRun(this.env, runId, event.instanceId);
      return { runId, state: "processed" };
    });
    return { runId, state: "processed" };
  }
}
