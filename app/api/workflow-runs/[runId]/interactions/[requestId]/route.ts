import { conversationIdSchema } from "../../../../../../adt-runtime/src/conversation-contract";
import { interactionIdSchema, interactionResponseSchema, MAX_INTERACTION_TEXT_BYTES } from "../../../../../../adt-runtime/src/workflow-interaction-contract";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { requireSameOrigin } from "@/lib/request-origin";
import { readBoundedJson, workflowError } from "@/lib/workflow-http";
import { workflowRepositoryContext } from "@/lib/workflow-run-admission";
import { workflowRuntimeCommand } from "@/lib/workflow-services";

type Context = { params: Promise<{ runId: string; requestId: string }> };

async function operate(request: Request, context: Context, submitting: boolean) {
  const auth = await requireApiRepositoryAccess(request, { fresh: submitting });
  if (auth instanceof Response) return auth;
  try {
    const { runId, requestId } = await context.params;
    const scope = workflowRepositoryContext(auth.access);
    const operation = { operation: "runs.interaction" as const, repositoryId: scope.repositoryId, scope,
      runId: conversationIdSchema.parse(runId), requestId: interactionIdSchema.parse(requestId) };
    if (!submitting) return Response.json(await workflowRuntimeCommand(operation), { headers: noStoreHeaders });
    requireSameOrigin(request);
    const response = interactionResponseSchema.parse(await readBoundedJson(request, MAX_INTERACTION_TEXT_BYTES * 6 + 1024));
    const actor = { githubId: auth.session.githubId, login: auth.session.login };
    const accepted = await workflowRuntimeCommand({ ...operation, submission: { response, actor } });
    return Response.json(accepted, { headers: noStoreHeaders });
  } catch (error) { return workflowError(error); }
}

export function GET(request: Request, context: Context) {
  return operate(request, context, false);
}

export function POST(request: Request, context: Context) {
  return operate(request, context, true);
}
