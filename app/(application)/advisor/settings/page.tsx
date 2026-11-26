import { Suspense } from "react";
import { AdvisorSettingsForm } from "@/components/AdvisorSettingsForm";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { PageHeader } from "@/components/Ui";
import { getAdvisorSettingsStore } from "@/lib/advisor-services";
import { requireRepositoryAccess } from "@/lib/auth";
import { createWorkflowDefinitionRepository, listWorkflowConnectionIdentityDescriptors } from "@/lib/workflow-services";

export default async function Page() {
  const { access } = await requireRepositoryAccess("/advisor/settings");
  const data = Promise.all([
    getAdvisorSettingsStore().then(store => store.get(access.repositoryId)),
    createWorkflowDefinitionRepository(access).listWorkflows(),
    listWorkflowConnectionIdentityDescriptors(access),
  ]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Advisor settings" description="Choose a Workflow for on-demand, read-only analysis." />
      <Suspense fallback={<ContentLoading label="Loading Advisor settings" />}>
        <AsyncContent data={data} failure="Advisor settings could not be loaded.">
          {([saved, workflows, connections]) => (
            <AdvisorSettingsForm initial={saved}
              workflows={workflows.map(({ definition }) => ({ id: definition.id, name: definition.name }))}
              connections={connections.filter(item => item.capabilities.agentTools && item.management === "git")
                .map(item => ({ key: item.key, name: item.name, model: item.defaultModel, enabled: item.enabled }))} />
          )}
        </AsyncContent>
      </Suspense>
    </div>
  );
}
