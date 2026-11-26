import { Suspense } from "react";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { PageHeader } from "@/components/Ui";
import { WorkflowAgentEditor } from "@/components/WorkflowAgentEditor";
import { requireRepositoryAccess } from "@/lib/auth";
import { getWorkflowAgentEditorSupport } from "@/lib/workflow-agent-editor-support";

export default async function Page() {
  const { access } = await requireRepositoryAccess("/workflows/agents/new");
  const data = getWorkflowAgentEditorSupport(access);
  return (
    <div className="max-w-4xl">
      <PageHeader title="New agent" description="Configure a reusable Agent and its provider connection." />
      <Suspense fallback={<ContentLoading label="Loading Agent editor" />}>
        <AsyncContent data={data} failure="The Agent editor could not load its supporting data.">
          {support => <WorkflowAgentEditor {...support} />}
        </AsyncContent>
      </Suspense>
    </div>
  );
}
