import type { ProviderManagementRequest, ProviderReadiness } from "../adt-runtime/src/runtime-control-contract.ts";
import { resolveApiKeySnapshotCredential } from "./git-workflow-provider-connection-store.ts";
import { safeConnectionSnapshot, type ConnectionDescriptor } from "./workflow-connections.ts";
import { assertCompatibleConnectionTypeChange } from "./provider-authentication-lifecycle.ts";
import { assertProviderConfigurationMutable, assertProviderCredentialContract, normalizeProviderSafeConfiguration, requireProviderConnectionType } from "./provider-connection-types.ts";
import { parseWorkIqPrivateBundle, resolveWorkIqConnection, resolveWorkIqSnapshotAuthorization } from "./work-iq-auth.ts";
import type { D1ProviderCredentialVault } from "./provider-credential-vault.ts";
import type { ProviderModelService } from "./provider-model-service.ts";
import { OpenAIModelError, type OpenAIModelFailure } from "./openai-models.ts";
import { RemoteRuntimeFailure, type AdrianTestDiagnostic } from "./adt-runtime-client.ts";
import { testWorkflowConnection } from "./workflow-connection-test.ts";
import type { AgentProviderAdapter, FailureCategory } from "./workflow-adapter.ts";

type ManagedVault = Pick<D1ProviderCredentialVault, "resolve" | "resolveWithRevision" | "replaceIfRevision">;
type ModelService = Pick<ProviderModelService, "listForPolicy" | "validateForPolicy">;
export type ProviderDiagnosticFailure = {
  category: FailureCategory; runtimeCode?: string; runtimeRevision?: string; runtimeReleaseRevision?: number;
  securityDiagnostic?: AdrianTestDiagnostic;
};
export type ProviderModelResult = { ok: true; models?: string[] } | {
  ok: false; openAI?: { code: OpenAIModelFailure; httpStatus?: number }; runtime?: ProviderDiagnosticFailure;
};

export function providerDiagnosticFailure(error: RemoteRuntimeFailure): ProviderDiagnosticFailure {
  const { category, runtimeCode, runtimeRevision, runtimeReleaseRevision, securityDiagnostic } = error;
  return { category, runtimeCode, runtimeRevision, runtimeReleaseRevision, securityDiagnostic };
}

export async function manageProviderConnection(
  request: ProviderManagementRequest, vault: ManagedVault, models: ModelService,
  adapters: () => Map<string, AgentProviderAdapter>,
) {
  const snapshot = (connection: ConnectionDescriptor) =>
    connection.adapter === "work-iq-rest" ? resolveWorkIqSnapshotAuthorization(connection.key, connection, vault)
      : resolveApiKeySnapshotCredential(connection.key, connection, vault);
  async function readiness(connection: ConnectionDescriptor): Promise<ProviderReadiness> {
    let configured = false;
    try {
      const type = requireProviderConnectionType(connection.adapter);
      if (type.authentication === "delegated-oauth") {
        if (!connection.credentialSecretRef || connection.credentialSource !== "adt-vault") return { configured, enabled: false };
        const { value } = await vault.resolveWithRevision(connection.credentialSecretRef);
        const bundle = parseWorkIqPrivateBundle(value);
        return { configured: true, enabled: Boolean(bundle.refreshToken && bundle.authorizationContextId),
          ...(bundle.authorizationContextId ? { authorizationContextId: bundle.authorizationContextId } : {}) };
      }
      const resolved = await resolveApiKeySnapshotCredential(connection.key, connection, vault);
      configured = true;
      // Ollama endpoints are commissioned explicitly. Listing only checks the optional credential.
      if (type.authentication !== "optional-api-key") {
        await models.validateForPolicy(type, resolved.credential, resolved.defaultModel, resolved.providerConfiguration);
      }
      return { configured, enabled: true };
    } catch { return { configured, enabled: false }; }
  }

  switch (request.action) {
    case "describe": return Promise.all(request.connections.map(readiness));
    case "snapshot": return safeConnectionSnapshot(await snapshot(request.connection));
    case "test": {
      const connection = request.connection;
      const result = await testWorkflowConnection(connection.key, {
        resolveForExecution: async () => {
          if (connection.adapter !== "work-iq-rest") return snapshot(connection);
          const status = await readiness(connection);
          if (!status.enabled) throw new Error("connection_unavailable");
          return resolveWorkIqConnection(connection.key, { ...connection, ...status }, vault);
        },
      }, adapters(), models);
      // Diagnostic providers may emit arbitrary text. Only the outcome crosses the service boundary.
      return result.ok ? { ok: true, outputText: "Provider connection verified." } : result;
    }
    case "models":
    case "validate": {
      const type = requireProviderConnectionType(request.connectionType);
      if (!type.model.discovery || type.authentication === "delegated-oauth") throw new Error("model_discovery_unsupported");
      const configuration = normalizeProviderSafeConfiguration(type, request.configuration);
      const source = request.credentials;
      let credential: string | undefined;
      if (source.source === "saved") {
        const connection = source.connection;
        assertCompatibleConnectionTypeChange(requireProviderConnectionType(connection.adapter), type);
        assertProviderConfigurationMutable(type, connection.providerConfiguration, configuration);
        credential = (await resolveApiKeySnapshotCredential(connection.key, connection, vault)).credential;
      } else {
        credential = source.credential;
      }
      assertProviderCredentialContract(type, configuration, credential);
      try {
        if (request.action === "validate") {
          await models.validateForPolicy(type, credential, request.model, configuration);
          return { ok: true } satisfies ProviderModelResult;
        }
        const ids = await models.listForPolicy(type, credential, configuration);
        return { ok: true, models: ids.filter(id => !credential || !id.includes(credential)) } satisfies ProviderModelResult;
      } catch (error) {
        if (error instanceof OpenAIModelError) {
          return { ok: false, openAI: { code: error.code, httpStatus: error.httpStatus } } satisfies ProviderModelResult;
        }
        if (error instanceof RemoteRuntimeFailure) {
          return { ok: false, runtime: providerDiagnosticFailure(error) } satisfies ProviderModelResult;
        }
        throw error;
      }
    }
  }
}
