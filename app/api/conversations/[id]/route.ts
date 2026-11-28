import { z } from "zod";
import { conversationIdSchema, conversationTitleSchema } from "../../../../adt-runtime/src/conversation-contract";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import type { ConversationDetail, ConversationSummary } from "@/lib/conversation-types";
import { readBoundedJson, workflowError } from "@/lib/workflow-http";
import { workflowRepositoryContext } from "@/lib/workflow-run-admission";
import { workflowRuntimeCommand } from "@/lib/workflow-services";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  try {
    const id = conversationIdSchema.parse((await context.params).id);
    const raw = new URL(request.url).searchParams.get("before");
    const before = raw === null ? undefined : z.coerce.number().int().positive().max(2_147_483_647).parse(raw);
    const scope = workflowRepositoryContext(auth.access);
    const data = await workflowRuntimeCommand<ConversationDetail | null>({ operation: "conversations.detail", repositoryId: scope.repositoryId,
      scope, id, before });
    if (!data) throw new Error("conversation_not_found");
    return Response.json(data, { headers: noStoreHeaders });
  } catch (error) { return workflowError(error); }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  try {
    const id = conversationIdSchema.parse((await context.params).id);
    const { title } = z.object({ title: conversationTitleSchema }).strict().parse(await readBoundedJson(request, 2048));
    const scope = workflowRepositoryContext(auth.access);
    const result = await workflowRuntimeCommand<ConversationSummary>({ operation: "conversations.rename", repositoryId: scope.repositoryId,
      scope, id, title });
    return Response.json(result, { headers: noStoreHeaders });
  } catch (error) { return workflowError(error); }
}
