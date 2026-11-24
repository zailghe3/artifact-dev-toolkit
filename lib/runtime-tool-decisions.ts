import type { RuntimeControlCommand } from "../adt-runtime/src/runtime-control-contract.ts";
import { approvalInvocation, toolApprovalAuthority } from "./agent-tool-approval-authority.ts";
import { hasToolRole, requireToolRole } from "./agent-tool-roles.ts";
import { isSensitiveAdtTool } from "./adt-data-contract.ts";

export async function operateRuntimeTools(input: Pick<Parameters<typeof toolApprovalAuthority>[0], "journal" | "runId" | "repositoryId" | "repository" | "policies" | "vault"> & {
  actor: string;
  decision?: Extract<RuntimeControlCommand, { operation: "runs.tools" }>["decision"];
  env: Record<string, string | undefined>;
  wake(runId: string): Promise<void>;
}) {
  const { actor, decision, journal, runId, repositoryId, repository, policies, vault, env, wake } = input;
  const requireAuthority = (invocationId: string, choice: "approved" | "rejected") =>
    toolApprovalAuthority({ journal, runId, invocationId, decision: choice, actor,
      repositoryId, repository, policies, vault });
  if (!decision) {
    const operator = hasToolRole(actor, "operator", env);
    const tools = (await journal.inspect(runId, operator, actor)).map(tool =>
      ({ ...tool, approval: tool.approval ? { ...tool.approval, canReject: tool.approval.canDecide } : undefined }));
    for (const tool of tools) {
      if (!tool.approval?.canDecide) continue;
      try { await requireAuthority(tool.id, "approved"); } catch { tool.approval.canDecide = false; }
    }
    return { tools, operator };
  }
  if (decision.action === "reconcile") {
    requireToolRole(actor, "operator", env);
    await journal.reconcile({ runId, actor, ...decision });
  } else {
    requireToolRole(actor, "approver", env);
    const invocationId = await approvalInvocation(journal, runId, decision.approvalId);
    const call = await journal.call(invocationId);
    if (decision.decision === "approved" && call && isSensitiveAdtTool(call.tool_key) &&
        decision.sensitiveDisclosureAcknowledged !== true) throw new Error("permission_denied");
    await journal.decide({ runId, actor, ...decision, policyAuthority: await requireAuthority(invocationId, decision.decision) });
  }
  await wake(runId);
  return { recorded: true };
}
