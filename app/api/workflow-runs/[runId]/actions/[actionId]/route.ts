import { createHash } from "node:crypto";
import { conversationIdSchema, workflowActionIdSchema } from "../../../../../../adt-runtime/src/conversation-contract";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import type { KnowledgeProposal } from "@/lib/advisor-knowledge-proposals";
import { requireSameOrigin } from "@/lib/request-origin";
import { workflowError } from "@/lib/workflow-http";
import { workflowRepositoryContext } from "@/lib/workflow-run-admission";
import { workflowRuntimeCommand } from "@/lib/workflow-services";

type Context = { params: Promise<{ runId: string; actionId: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  try {
    const { runId, actionId } = await context.params;
    const scope = workflowRepositoryContext(auth.access);
    return Response.json(await workflowRuntimeCommand({ operation: "runs.action", repositoryId: scope.repositoryId, scope,
      runId: conversationIdSchema.parse(runId), actionId: workflowActionIdSchema.parse(actionId) }), { headers: noStoreHeaders });
  } catch (error) { return workflowError(error); }
}

export async function POST(request: Request, context: Context) {
  const auth = await requireApiRepositoryAccess(request, { fresh: true });
  if (auth instanceof Response) return auth;
  try {
    requireSameOrigin(request);
    const { runId, actionId } = await context.params;
    const scope = workflowRepositoryContext(auth.access);
    const proposal = await workflowRuntimeCommand<KnowledgeProposal>({ operation: "knowledge.from-action", repositoryId: scope.repositoryId, scope,
      runId: conversationIdSchema.parse(runId), actionId: workflowActionIdSchema.parse(actionId),
      actor: { githubId: auth.session.githubId, login: auth.session.login, sessionId: createHash("sha256").update(auth.session.id).digest("hex") } });
    return Response.json({ id: proposal.id }, { headers: noStoreHeaders });
  } catch (error) { return workflowError(error); }
}
