import { Suspense } from "react";
import Link from "next/link";
import { AdvisorQuestion } from "@/components/AdvisorQuestion";
import { ContentLoading } from "@/components/ContentLoading";
import { EmptyState, PageHeader, Panel, buttonStyles } from "@/components/Ui";
import { validateAdvisorSelection } from "@/lib/advisor-configuration";
import { validateAdvisorDependencies } from "@/lib/advisor-dependencies";
import { getAdvisorSettingsStore } from "@/lib/advisor-services";
import { requireRepositoryAccess } from "@/lib/auth";
import type { RepositoryAccessContext } from "@/lib/repository-authorization";
import { workflowError } from "@/lib/workflow-http";
import { createWorkflowDefinitionRepository, listWorkflowConnectionIdentityDescriptors } from "@/lib/workflow-services";

async function AdvisorWorkspace({ access }: { access: RepositoryAccessContext }) {
  let selected: Awaited<ReturnType<typeof validateAdvisorSelection>>;
  let error: string | undefined;
  try {
    const [saved, connections] = await Promise.all([
      getAdvisorSettingsStore().then(store => store.get(access.repositoryId)),
      listWorkflowConnectionIdentityDescriptors(access),
    ]);
    selected = await validateAdvisorSelection(saved.settings, createWorkflowDefinitionRepository(access), connections,
      agents => validateAdvisorDependencies(access, agents));
  } catch (reason) {
    error = ((await workflowError(reason).json()) as { error: string }).error;
  }
  return (
    <div className="grid gap-4">
      {selected ? (
        <Panel>
          <h2 className="text-sm font-semibold">Advisor Workflow</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/workflows/definitions/${selected.workflow.id}`}>{selected.workflow.name}</Link>
            <Link className="text-muted-foreground underline-offset-4 hover:underline" href={`/workflows/definitions/${selected.workflow.id}/edit`}>Edit Workflow</Link>
          </div>
          <ul className="mt-2 text-sm text-muted-foreground">
            {selected.agents.map(agent => <li key={agent.id}>{agent.name} · {agent.connectionKey} · {agent.provider} · {agent.model}</li>)}
          </ul>
        </Panel>
      ) : error ? (
        <Panel><p role="alert">{error}</p></Panel>
      ) : (
        <EmptyState title="Advisor is not configured">
          <Link className="underline underline-offset-4" href="/advisor/settings">Select a Workflow</Link>
          {" or see the "}
          <a className="underline underline-offset-4" href="https://github.com/zailghe3/artifact-dev-toolkit/blob/main/docs/advisor-setup.md">default Workflow setup</a>.
        </EmptyState>
      )}
      <AdvisorQuestion configured={Boolean(selected) && !error} />
    </div>
  );
}

export default async function Page() {
  const { access } = await requireRepositoryAccess("/advisor");
  return (
    <>
      <PageHeader title="Advisor" description="Investigate Workflow configuration and execution evidence. Each question starts a fresh execution."
        action={<div className="flex flex-wrap gap-2">
          <Link href="/advisor/knowledge" className={buttonStyles.secondary}>Advisor knowledge</Link>
          <Link href="/advisor/settings" className={buttonStyles.secondary}>Advisor settings</Link>
        </div>} />
      <Suspense fallback={<ContentLoading label="Loading Advisor configuration" rows={2} />}>
        <AdvisorWorkspace access={access} />
      </Suspense>
    </>
  );
}
