import {
  Agent,
  MaxTurnsExceededError,
  ModelBehaviorError,
  ModelTimeoutError,
  OpenAIProvider,
  Runner,
  UserError,
  type ModelProvider,
  type ModelSettings,
} from "@openai/agents";
import type { AgentRuntime } from "./agent-runtime.ts";
import type { AdapterInvocation, AdapterResult, FailureCategory } from "./workflow-adapter.ts";
import { openAIResponsesOptionsSchema } from "./workflow-adapter.ts";

const ENDPOINT = "https://api.openai.com/v1";
export const OPENAI_AGENTS_MAX_TURNS = 1;

export type OpenAIAgentsProviderConfiguration = { apiKey: string; useResponses: true };
export type OpenAIAgentsRunnerConfiguration = { modelProvider: ModelProvider; tracingDisabled: true };
export type OpenAIAgentsRunConfiguration = { maxTurns: number };
export type OpenAIAgentsAgentConfiguration = {
  name: string;
  instructions: string;
  model: string;
  modelSettings: ModelSettings;
};

type RuntimeAgent = Agent<unknown, "text">;
type RuntimeRunner = Pick<Runner, "run">;
export type OpenAIAgentsRuntimeFactories = {
  createProvider(configuration: OpenAIAgentsProviderConfiguration): ModelProvider & { close?: () => Promise<void> };
  createRunner(configuration: OpenAIAgentsRunnerConfiguration): RuntimeRunner;
  createAgent(configuration: OpenAIAgentsAgentConfiguration): RuntimeAgent;
};

const defaults: OpenAIAgentsRuntimeFactories = {
  createProvider: configuration => new OpenAIProvider(configuration),
  createRunner: configuration => new Runner(configuration),
  createAgent: configuration => new Agent(configuration),
};

type RuntimeFailure = Error & { category: FailureCategory; retryable: false; safeMessage: string };
function failure(category: FailureCategory, safeMessage: string): RuntimeFailure {
  return Object.assign(new Error(category), { category, retryable: false as const, safeMessage });
}

function classifySDKFailure(error: unknown): RuntimeFailure {
  if (error instanceof MaxTurnsExceededError) return failure("provider_rejected", "The model exceeded the permitted execution turns.");
  if (error instanceof ModelTimeoutError) return failure("provider_timeout", "The model request timed out.");
  if (error instanceof ModelBehaviorError) return failure("malformed_response", "The model returned an invalid response.");
  if (error instanceof UserError) return failure("configuration_invalid", "The Agents runtime configuration is invalid.");
  const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
  if (status === 401) return failure("authentication_failed", "Authentication failed.");
  if (status === 403) return failure("permission_denied", "Permission denied.");
  if (status === 429) return failure("rate_limited", "Provider rate limited.");
  if (status !== undefined && status >= 500) return failure("provider_unavailable", "Provider temporarily unavailable.");
  if (status !== undefined && status >= 400) return failure("provider_rejected", "Configured model was rejected.");
  return failure("internal_error", "The Agents runtime failed unexpectedly.");
}

export function openAIAgentsModelSettings(options: unknown): ModelSettings {
  const parsed = openAIResponsesOptionsSchema.parse(options ?? {});
  return {
    store: false,
    parallelToolCalls: false,
    ...(parsed.maxOutputTokens !== undefined ? { maxTokens: parsed.maxOutputTokens } : {}),
    ...(parsed.reasoningEffort !== undefined ? { reasoning: { effort: parsed.reasoningEffort } } : {}),
    ...(parsed.verbosity !== undefined ? { text: { verbosity: parsed.verbosity } } : {}),
  };
}

/** Runs one bounded, stateless SDK invocation; ADT remains the durable orchestrator. */
export class OpenAIAgentsRuntime implements AgentRuntime {
  readonly kind = "openai-agents";
  private readonly factories: OpenAIAgentsRuntimeFactories;
  constructor(factories: OpenAIAgentsRuntimeFactories = defaults) { this.factories = factories; }

  async start(invocation: AdapterInvocation): Promise<AdapterResult> {
    const connection = invocation.connection;
    if (connection.adapter !== this.kind || connection.endpoint !== ENDPOINT || !connection.enabled)
      throw failure("configuration_invalid", "The Agents runtime connection is invalid.");
    if (!connection.defaultModel?.trim()) throw failure("configuration_invalid", "The Agents runtime model is missing.");
    if (typeof connection.credential !== "string" || !connection.credential.trim())
      throw failure("connection_unavailable", "Connection is not configured.");

    let modelSettings: ModelSettings;
    try { modelSettings = openAIAgentsModelSettings(invocation.providerOptions); }
    catch { throw failure("configuration_invalid", "The Agents runtime options are invalid."); }

    const provider = this.factories.createProvider({ apiKey: connection.credential, useResponses: true });
    const runner = this.factories.createRunner({ modelProvider: provider, tracingDisabled: true });
    const agent = this.factories.createAgent({
      name: invocation.agentName,
      instructions: invocation.masterPrompt,
      model: connection.defaultModel,
      modelSettings,
    });
    try {
      const result = await runner.run(agent, invocation.inputText, { maxTurns: OPENAI_AGENTS_MAX_TURNS });
      if (typeof result.finalOutput !== "string") throw failure("malformed_response", "The Agents runtime returned no textual output.");
      return { state: "completed", outputText: result.finalOutput };
    } catch (error) {
      if (error && typeof error === "object" && "category" in error) throw error;
      throw classifySDKFailure(error);
    } finally {
      await provider.close?.().catch(() => undefined);
    }
  }

  async check(): Promise<never> { throw failure("configuration_invalid", "The Agents runtime does not expose asynchronous tasks."); }
  async cancel() { return "unsupported" as const; }
}
