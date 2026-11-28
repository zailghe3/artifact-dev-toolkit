import { z } from "zod";
import { ADVISOR_WORKFLOW_ID, conversationCursorSchema, conversationSubmissionSchema } from "../../../adt-runtime/src/conversation-contract";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import type { ConversationList } from "@/lib/conversation-types";
import { launchConversationTurn, workflowRepositoryContext } from "@/lib/workflow-run-admission";
import { readBoundedJson, workflowError } from "@/lib/workflow-http";
import { workflowRuntimeCommand } from "@/lib/workflow-services";

export async function GET(request: Request) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  try {
    const params = new URL(request.url).searchParams;
    const query = z.string().trim().max(120).parse(params.get("q") ?? "");
    const before = params.has("before") ? conversationCursorSchema.parse({ id: params.get("before"), updatedAt: params.get("date") }) : undefined;
    const target = params.get("view") === "advisor" ? { kind: "workflow" as const, id: ADVISOR_WORKFLOW_ID } : undefined;
    const scope = workflowRepositoryContext(auth.access);
    const list = await workflowRuntimeCommand<ConversationList>({ operation: "conversations.list", repositoryId: scope.repositoryId,
      scope, query, target, before });
    return Response.json(list, { headers: noStoreHeaders });
  } catch (error) { return workflowError(error); }
}

export async function POST(request: Request) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  try {
    const input = conversationSubmissionSchema.parse(await readBoundedJson(request, 400_000));
    const launched = await launchConversationTurn(auth.access, input);
    return Response.json(launched, { status: launched.replay ? 200 : 201, headers: noStoreHeaders });
  } catch (error) { return workflowError(error); }
}
