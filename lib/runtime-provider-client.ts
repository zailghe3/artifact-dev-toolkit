import type { ProviderManagementRequest, ProviderReadiness, RuntimeControlCommand } from "../adt-runtime/src/runtime-control-contract.ts";
import { providerConnectionSnapshotSchema } from "../adt-runtime/src/runtime-control-contract.ts";
import { RemoteRuntimeFailure } from "./adt-runtime-client.ts";
import { providerConnectionDescriptor } from "./git-workflow-provider-connection-store.ts";
import { OpenAIModelError } from "./openai-models.ts";
import type { ProviderModelResult } from "./runtime-provider-management.ts";
import type { WorkflowConnectionDefinitionRepository } from "./workflow-connection-definition-repository.ts";
import type { ConnectionTestResult } from "./workflow-adapter.ts";
import type { ConnectionDescriptor } from "./workflow-connections.ts";

type Command = Extract<RuntimeControlCommand, { operation: "provider" }>;
export type ProviderCommandClient = <T>(command: Command) => Promise<T>;
type ModelsRequest = Extract<ProviderManagementRequest, { action: "models" | "validate" }>;

export function runtimeProviderClient(repositoryId: number, send: ProviderCommandClient) {
  const request = <T>(input: ProviderManagementRequest) => send<T>({ operation: "provider", repositoryId, request: input });
  async function models(input: ModelsRequest) {
    const result = await request<ProviderModelResult>(input);
    if (result.ok) return result.models ?? [];
    if (result.openAI) throw new OpenAIModelError(result.openAI.code, result.openAI.httpStatus);
    if (result.runtime) {
      const failure = result.runtime;
      throw new RemoteRuntimeFailure(failure.category, "Runtime model commissioning failed.", undefined, failure.runtimeCode,
        undefined, failure.runtimeRevision, failure.securityDiagnostic, failure.runtimeReleaseRevision);
    }
    throw new Error("runtime_unavailable");
  }
  const supplied = (credential: string | undefined) => ({ source: "input" as const, credential });
  const saved = (connection: ConnectionDescriptor) => ({ source: "saved" as const, connection: providerConnectionSnapshotSchema.parse(connection) });
  return {
    list: (connectionType: string, credential?: string, configuration?: unknown) =>
      models({ action: "models", connectionType, configuration, credentials: supplied(credential) }),
    validate: async (connectionType: string, credential: string | undefined, model: string | undefined, configuration?: unknown) => {
      await models({ action: "validate", connectionType, model, configuration, credentials: supplied(credential) });
    },
    listSaved: (connection: ConnectionDescriptor, connectionType: string, configuration?: unknown) =>
      models({ action: "models", connectionType, configuration, credentials: saved(connection) }),
    validateSaved: async (connection: ConnectionDescriptor, connectionType: string, model: string | undefined, configuration?: unknown) => {
      await models({ action: "validate", connectionType, model, configuration, credentials: saved(connection) });
    },
    describe: (connections: ConnectionDescriptor[]) => request<ProviderReadiness[]>({
      action: "describe", connections: connections.map(connection => providerConnectionSnapshotSchema.parse(connection)),
    }),
    snapshot: (connection: ConnectionDescriptor) => request<ConnectionDescriptor>({ action: "snapshot", connection: saved(connection).connection }),
    test: (connection: ConnectionDescriptor) => request<ConnectionTestResult>({ action: "test", connection: saved(connection).connection }),
  };
}

export function runtimeProviderConnectionStore(
  git: Pick<WorkflowConnectionDefinitionRepository, "listConnections" | "getConnection">,
  client: Pick<ReturnType<typeof runtimeProviderClient>, "describe" | "snapshot" | "test">,
) {
  async function describe(connections: ConnectionDescriptor[]) {
    const result: ConnectionDescriptor[] = [];
    for (let start = 0; start < connections.length; start += 25) {
      const batch = connections.slice(start, start + 25);
      const statuses = await client.describe(batch).catch(() => batch.map(() => ({ enabled: false, configured: false })));
      result.push(...batch.map((connection, index) => ({ ...connection, ...statuses[index] })));
    }
    return result;
  }
  return {
    async listSafeDescriptors() { return describe((await git.listConnections()).map(value => providerConnectionDescriptor(value, false))); },
    async getSafeDescriptor(key: string) {
      const value = await git.getConnection(key);
      return value ? (await describe([providerConnectionDescriptor(value, false)]))[0] : undefined;
    },
    async resolveForSnapshot(key: string, snapshot: ConnectionDescriptor) {
      if (key !== snapshot.key) throw new Error("connection_unavailable");
      return client.snapshot(snapshot);
    },
    async testConnection(key: string): Promise<ConnectionTestResult> {
      const value = await git.getConnection(key);
      if (!value) return { ok: false, category: "connection_unavailable", safeMessage: "Connection is not configured." };
      return client.test(providerConnectionDescriptor(value, false));
    },
  };
}
