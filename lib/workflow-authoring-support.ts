import "server-only";

import { grantKey } from "@/adt-runtime/src/agent-contract";

import type { RepositoryAccessContext } from "@/lib/repository-authorization";
import { isAgentPublishAuthoringEligible } from "@/lib/workflow-publish-eligibility";
import { createWorkflowDefinitionRepository, listWorkflowConnectionIdentityDescriptors } from "@/lib/workflow-services";

export async function getWorkflowAuthoringAgents(access: RepositoryAccessContext) {
  const [agents, connections] = await Promise.all([
    createWorkflowDefinitionRepository(access).listAgents(),
    listWorkflowConnectionIdentityDescriptors(access),
  ]);
  return agents.map(({ definition }) => {
    const options = definition.adapterOptions as { environmentKey?: unknown; managedGit?: unknown; continueFrom?: unknown } | undefined;
    return {
      id: definition.id,
      name: definition.name,
      toolKeys: (definition.tools ?? []).map(grantKey),
      description: definition.description,
      publishEligible: isAgentPublishAuthoringEligible(definition, connections),
      connectionKey: definition.connectionKey,
      adapter: connections.find(connection => connection.key === definition.connectionKey)?.adapter,
      environmentKey: typeof options?.environmentKey === "string" ? options.environmentKey : undefined,
      managedGit: options?.managedGit === true,
      agentContinueFrom: Boolean(options?.continueFrom),
    };
  });
}
