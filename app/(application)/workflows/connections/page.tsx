import { Suspense } from "react";
import { AsyncContent } from "@/components/AsyncContent";
import { ContentLoading } from "@/components/ContentLoading";
import { CodexRunnerConnection } from "@/components/CodexRunnerConnection";
import { ConnectionCatalogue } from "@/components/ConnectionCatalogue";
import { PageHeader } from "@/components/Ui";
import { requireRepositoryAccess } from "@/lib/auth";
import { getSafeCodexConnectionStatus } from "@/lib/codex-runner-status";
import { getRuntimeCodexRunnerClient, getWorkflowProviderConnectionStore } from "@/lib/workflow-services";

export default async function Page() {
  const { access } = await requireRepositoryAccess("/workflows/connections");
  const connections = getWorkflowProviderConnectionStore(access).then(store => store.listSafeDescriptors());
  const codex = getSafeCodexConnectionStatus({ clientFactory: () => getRuntimeCodexRunnerClient(access.repositoryId) });
  return (
    <>
      <PageHeader title="Connections" description="Manage the external AI providers used by Agents."
        action={{ href: "/workflows/connections/new", label: "New connection" }} />
      <div className="grid gap-8">
        <section aria-labelledby="provider-connections-heading">
          <h2 id="provider-connections-heading" className="mb-3 text-lg font-semibold">Provider connections</h2>
          <Suspense fallback={<ContentLoading label="Loading provider connections" cards />}>
            <AsyncContent data={connections} failure="Provider connections could not be loaded.">
              {connections => <ConnectionCatalogue connections={connections} />}
            </AsyncContent>
          </Suspense>
        </section>
        <section aria-labelledby="built-in-connection-heading">
          <h2 id="built-in-connection-heading" className="text-lg font-semibold">Built-in runtime connection</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">Operational connection to the independently managed Codex Runner.</p>
          <Suspense fallback={<ContentLoading label="Checking Codex Runner connection" rows={1} />}>
            <AsyncContent data={codex} failure="The Codex Runner connection could not be checked.">
              {status => <CodexRunnerConnection initialStatus={status} />}
            </AsyncContent>
          </Suspense>
        </section>
      </div>
    </>
  );
}
