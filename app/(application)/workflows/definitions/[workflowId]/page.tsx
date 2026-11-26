import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { PageHeader, buttonStyles } from "@/components/Ui";
import { WorkflowLayoutEditor } from "@/components/WorkflowLayoutEditor";
import { WorkflowRunStart } from "@/components/WorkflowRunControls";
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
        action={<Link className={buttonStyles.secondary} href={`/workflows/definitions/${workflowId}/edit`}>Edit</Link>} />
      <Suspense fallback={<ContentLoading label="Loading workflow graph" />}>
        <AsyncContent data={graph} failure="The Workflow graph could not be loaded.">
          {([agents, layout]) => <WorkflowLayoutEditor workflow={value.definition} workflowFileSha={value.fileSha}
            agents={Object.fromEntries(agents.map(item => [item.definition.id, item.definition.name]))} initialLayout={layout} />}
        </AsyncContent>
      </Suspense>
      <section className="mt-8 max-w-3xl" aria-labelledby="start-workflow">
        <h2 id="start-workflow" className="text-xl font-semibold">Start workflow</h2>
        <WorkflowRunStart workflowId={workflowId} initialInput={value.definition.runInputTemplate} />
      </section>
    </>
  );
}
