// OpenNext generates this module before Wrangler bundles the custom entrypoint.
// @ts-expect-error generated build output has no source-time declaration
import nextWorker from "./.open-next/worker.js";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export default nextWorker;

/** Durable entrypoint. The workflow payload deliberately contains only the D1 run identifier. */
export class AgentRunWorkflow extends WorkflowEntrypoint<CloudflareEnv, { runId: string }> {
  async run(event: Readonly<WorkflowEvent<{ runId: string }>>, step: WorkflowStep) {
    const runId = event.payload.runId;
    if (!runId || Object.keys(event.payload).length !== 1) throw new Error("invalid_workflow_payload");
    const runtime = await import("@/lib/workflow-worker-runtime");
    return runtime.executeWorkflowRun(this.env, runId, event.instanceId, step);
  }
}
