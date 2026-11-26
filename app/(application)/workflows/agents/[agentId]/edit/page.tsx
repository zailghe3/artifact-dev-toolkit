import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { PageHeader } from "@/components/Ui";
import { WorkflowAgentEditor } from "@/components/WorkflowAgentEditor";
import { getArtifact } from "@/lib/artifacts";
import { requireRepositoryAccess } from "@/lib/auth";
import { validateAdapterOptions } from "@/lib/workflow-adapter";
import { getWorkflowAgentEditorSupport } from "@/lib/workflow-agent-editor-support";
import { workflowAgentPromptDescriptor } from "@/lib/workflow-agent-prompts";
import { createWorkflowDefinitionRepository } from "@/lib/workflow-services";

export default async function Page({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const { access } = await requireRepositoryAccess(`/workflows/agents/${agentId}/edit`);
  const value = await createWorkflowDefinitionRepository(access).getAgent(agentId);
  if (!value) notFound();
  const prompt = value.definition.prompt;
  const data = Promise.all([
    getWorkflowAgentEditorSupport(access),
    prompt.source === "artifact" ? getArtifact(access, prompt.artifactId) : undefined,
  ]);
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${value.definition.name}`} description="Update this Agent without changing its permanent identifier." />
      <Suspense fallback={<ContentLoading label="Loading Agent editor" />}>
        <AsyncContent data={data} failure="The Agent editor could not load its supporting data.">
          {([support, artifact]) => {
            const connection = support.connections.find(connection => connection.key === value.definition.connectionKey);
            if (!connection) notFound();
            const initial = { ...value.definition, adapterOptions: validateAdapterOptions(connection.adapter, value.definition.adapterOptions) };
            return <WorkflowAgentEditor {...support} initial={initial} fileSha={value.fileSha} initialArtifact={workflowAgentPromptDescriptor(artifact)} />;
          }}
        </AsyncContent>
      </Suspense>
    </div>
  );
}
