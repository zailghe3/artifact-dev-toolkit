import { z } from "zod";
import { conversationIdSchema } from "../../../../../adt-runtime/src/conversation-contract";
import { runActivityCursorSchema, runContentCursorSchema } from "../../../../../adt-runtime/src/runtime-control-contract";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { workflowError } from "@/lib/workflow-http";
import { workflowRepositoryContext } from "@/lib/workflow-run-admission";
import { workflowRuntimeCommand } from "@/lib/workflow-services";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireApiRepositoryAccess(request);
  if (auth instanceof Response) return auth;
  try {
    const query = new URL(request.url).searchParams;
    const view = z.enum(["activity", "content", "display"]).parse(query.get("view"));
    const scope = workflowRepositoryContext(auth.access);
    const run = { scope, repositoryId: scope.repositoryId, runId: conversationIdSchema.parse((await params).runId) };
    const id = query.get("beforeId");
    const result = view === "activity"
      ? await workflowRuntimeCommand({ ...run, operation: "runs.activity",
          before: id ? runActivityCursorSchema.parse({ at: query.get("beforeAt"), id }) : undefined })
      : view === "content"
        ? await workflowRuntimeCommand({ ...run, operation: "runs.content",
            before: id ? runContentCursorSchema.parse({ sequence: Number(query.get("beforeSequence")), id }) : undefined })
        : await workflowRuntimeCommand({ ...run, operation: "runs.display",
            activationId: z.string().min(1).max(256).parse(query.get("activationId")) });
    return Response.json(result, { headers: noStoreHeaders });
  } catch (error) { return workflowError(error); }
}
