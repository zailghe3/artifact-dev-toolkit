import { ADVISOR_WORKFLOW_ID, conversationIdSchema, conversationTargetSchema } from "../adt-runtime/src/conversation-contract.ts";
import { requireRepositoryAccess } from "@/lib/auth";
import { conversationHref, type ConversationView } from "@/lib/conversation-client";
import { ConversationWorkspace } from "./ConversationWorkspace";

export async function ConversationPage({ view, params }: { view: ConversationView; params: Record<string, string | string[] | undefined> }) {
  const id = conversationIdSchema.safeParse(params.conversation).data;
  const target = view === "/advisor" ? { kind: "workflow" as const, id: ADVISOR_WORKFLOW_ID } : conversationTargetSchema.safeParse({
    kind: params.agent ? "agent" : "workflow", id: params.agent ?? params.workflow,
  }).data;
  const { access } = await requireRepositoryAccess(conversationHref(view, id, view === "/advisor" ? undefined : target));
  const draftScope = `${access.repositoryId}:${access.githubId}:${access.installationId}:${process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH ?? "main"}`;
  return <ConversationWorkspace view={view} id={id} preselected={target} draftScope={draftScope} />;
}
