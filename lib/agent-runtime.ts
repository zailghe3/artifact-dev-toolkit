import { CodexCloudAdapter } from "./codex-cloud-adapter.ts";
import { UnavailableCodexCloudGateway } from "./codex-cloud-gateway.ts";
import { CodexRunnerAdapter } from "./codex-runner-adapter.ts";
import { OpenAIResponsesAdapter } from "./openai-responses-adapter.ts";
import { DeterministicTestAdapter, type AdapterInvocation, type AdapterResult, type AgentProviderAdapter } from "./workflow-adapter.ts";

export interface AgentRuntime {
  readonly kind: string;
  start(invocation: AdapterInvocation): Promise<AdapterResult>;
  check(taskId: string, invocation: AdapterInvocation): ReturnType<AgentProviderAdapter["check"]>;
  cancel(taskId: string, invocation: AdapterInvocation): Promise<"cancelled" | "cancellation_pending" | "already_terminal" | "unsupported">;
}

export interface AgentRuntimeResolver {
  resolve(kind: string): AgentRuntime | undefined;
}

/** Delegates execution without moving durable orchestration policy into provider code. */
export class AdapterBackedAgentRuntime implements AgentRuntime {
  readonly kind: string;
  private readonly adapter: AgentProviderAdapter;

  constructor(adapter: AgentProviderAdapter) {
    this.adapter = adapter;
    this.kind = adapter.kind;
  }

  start(invocation: AdapterInvocation) { return this.adapter.start(invocation); }
  check(taskId: string, invocation: AdapterInvocation) { return this.adapter.check(taskId, invocation); }
  cancel(taskId: string, invocation: AdapterInvocation) { return this.adapter.cancel?.(taskId, invocation) ?? Promise.resolve("unsupported" as const); }
}

export class AgentRuntimeRegistry implements AgentRuntimeResolver {
  private readonly runtimes: Map<string, AgentRuntime>;

  constructor(runtimes: Iterable<AgentRuntime>) {
    this.runtimes = new Map(Array.from(runtimes, runtime => [runtime.kind, runtime]));
  }

  resolve(kind: string) { return this.runtimes.get(kind); }
}

export function createAdapterBackedAgentRuntimeRegistry(adapters: Iterable<AgentProviderAdapter>) {
  return new AgentRuntimeRegistry(Array.from(adapters, adapter => new AdapterBackedAgentRuntime(adapter)));
}

export function createWorkflowAdapterRegistry(fetcher?: ConstructorParameters<typeof OpenAIResponsesAdapter>[0]): Map<string, AgentProviderAdapter> {
  const adapters: AgentProviderAdapter[] = [
    new DeterministicTestAdapter(),
    new OpenAIResponsesAdapter(fetcher),
    new CodexRunnerAdapter(),
    new CodexCloudAdapter(new UnavailableCodexCloudGateway()),
  ];
  return new Map(adapters.map(adapter => [adapter.kind, adapter]));
}

export function createAgentRuntimeRegistry(fetcher?: ConstructorParameters<typeof OpenAIResponsesAdapter>[0]): AgentRuntimeRegistry {
  return createAdapterBackedAgentRuntimeRegistry(createWorkflowAdapterRegistry(fetcher).values());
}
