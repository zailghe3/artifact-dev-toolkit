import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { PageHeader, buttonStyles } from "@/components/Ui";
import { WorkflowLayoutEditor } from "@/components/WorkflowLayoutEditor";
import { conversationHref } from "@/lib/conversation-client";
import { requireRepositoryAccess } from "@/lib/auth";
import { createWorkflowDefinitionRepository, createWorkflowLayoutRepository } from "@/lib/workflow-services";

export default async function Page({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;
  const { access } = await requireRepositoryAccess(`/workflows/definitions/${workflowId}`);
  const repo = createWorkflowDefinitionRepository(access);
  const value = await repo.getWorkflow(workflowId);
  if (!value) notFound();
  const graph = Promise.all([repo.listAgents(), createWorkflowLayoutRepository(access).getLayout(workflowId)]);
  return (
    <>
      <PageHeader title={value.definition.name} description={value.definition.description}
        meta={<>Schema v2 · Revision <code>{value.fileSha}</code></>}
        action={<div className="flex flex-wrap gap-2"><Link className={buttonStyles.secondary} href={`/workflows/definitions/${workflowId}/edit`}>Edit</Link><Link className={buttonStyles.primary} href={conversationHref("/conversations", undefined, { kind: "workflow", id: workflowId })}>Start conversation</Link></div>} />
      <Suspense fallback={<ContentLoading label="Loading workflow graph" />}>
        <AsyncContent data={graph} failure="The Workflow graph could not be loaded.">
          {([agents, layout]) => <WorkflowLayoutEditor workflow={value.definition} workflowFileSha={value.fileSha}
            agents={Object.fromEntries(agents.map(item => [item.definition.id, item.definition.name]))} initialLayout={layout} />}
        </AsyncContent>
      </Suspense>
    </>
  );
}
