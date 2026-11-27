import { ADVISOR_WORKFLOW_ID } from "../../../../adt-runtime/src/conversation-contract";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import type { ConversationTargetOption } from "@/lib/conversation-types";
import { workflowError } from "@/lib/workflow-http";
import { createWorkflowDefinitionRepository } from "@/lib/workflow-services";

export async function GET(request: Request) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  try {
    const repo = createWorkflowDefinitionRepository(auth.access);
    const advisor = new URL(request.url).searchParams.get("view") === "advisor";
    const [agents, workflows] = advisor
      ? [[], [await repo.getWorkflow(ADVISOR_WORKFLOW_ID)].filter(item => item !== undefined)]
      : await Promise.all([repo.listAgents(), repo.listWorkflows()]);
    const targets: ConversationTargetOption[] = [
      ...agents.map(({ definition }) => ({ kind: "agent" as const, id: definition.id, name: definition.name })),
      ...workflows.map(({ definition }) => ({ kind: "workflow" as const, id: definition.id, name: definition.name,
        starter: definition.runInputTemplate })),
    ];
    return Response.json({ targets }, { headers: noStoreHeaders });
  } catch (error) { return workflowError(error); }
}
