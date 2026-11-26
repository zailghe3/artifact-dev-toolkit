import "server-only";

import type { RepositoryAccessContext } from "@/lib/repository-authorization";
import {
  createToolDefinitionRepository, listSafeSecurityProfiles, listWorkflowConnectionDescriptors, readCodexRunnerCatalog,
} from "@/lib/workflow-services";

export async function getWorkflowAgentEditorSupport(access: RepositoryAccessContext) {
  const snapshot = readCodexRunnerCatalog(access.repositoryId);
  const [codexSnapshot, connections, tools, profiles] = await Promise.all([
    snapshot,
    listWorkflowConnectionDescriptors(snapshot, access),
    createToolDefinitionRepository(access).list(),
    listSafeSecurityProfiles(access),
  ]);
  return {
    codexSnapshot,
    connections,
    mcpServers: tools.map(({ definition }) => ({
      ...definition,
      authentication: {
        mode: definition.authentication.mode,
        credentialConfigured: definition.authentication.mode === "bearer",
      },
    })),
    securityProfiles: profiles.map(({ definition: { id, name, credentialConfigured } }) => ({
      id, name, credentialConfigured,
    })),
  };
}
