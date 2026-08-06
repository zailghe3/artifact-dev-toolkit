import type { ConnectionDescriptor, ResolvedConnection } from "./workflow-connections.ts";

export type FailureCategory = "configuration_invalid" | "connection_unavailable" | "authentication_failed" | "permission_denied" | "provider_rejected" | "rate_limited" | "provider_unavailable" | "provider_timeout" | "malformed_response" | "output_too_large" | "cancelled" | "internal_error";
export type AdapterInvocation = { runId: string; stepId: string; iteration: number; attempt: number; idempotencyKey: string; agentName: string; masterPrompt: string; inputText: string; connection: ResolvedConnection; providerOptions?: unknown };
export type AdapterResult = { state: "pending"; taskId: string; pollAfterMs?: number } | { state: "completed"; outputText: string; externalUrl?: string };
export interface AgentProviderAdapter {
  readonly kind: string;
  validateConnection(descriptor: ConnectionDescriptor): Promise<{ ok: true } | { ok: false; safeMessage: string }>;
  start(invocation: AdapterInvocation): Promise<AdapterResult>;
  check(taskId: string, invocation: AdapterInvocation): Promise<{ state: "pending"; pollAfterMs?: number } | { state: "completed"; outputText: string; externalUrl?: string } | { state: "failed"; category: FailureCategory; retryable: boolean; safeMessage: string }>;
  cancel?(taskId: string, invocation: AdapterInvocation): Promise<"cancelled" | "already_terminal" | "unsupported">;
}

export type DeterministicOptions = { mode?: "immediate" | "pending" | "transient_failure" | "terminal_failure" | "oversized"; pendingChecks?: number; cancellation?: "supported" | "unsupported" };
export class DeterministicTestAdapter implements AgentProviderAdapter {
  readonly kind = "deterministic-test";
  readonly starts = new Map<string, number>();
  private checks = new Map<string, number>();
  async validateConnection(descriptor: ConnectionDescriptor) { return descriptor.enabled ? { ok: true as const } : { ok: false as const, safeMessage: "The deterministic test connection is disabled." }; }
  private output(invocation: AdapterInvocation, oversized = false) { const value = `Agent: ${invocation.agentName}\nInput:\n${invocation.inputText}`; return oversized ? value.padEnd(262145, "x") : value; }
  async start(invocation: AdapterInvocation): Promise<AdapterResult> {
    this.starts.set(invocation.idempotencyKey, (this.starts.get(invocation.idempotencyKey) ?? 0) + 1);
    const options = (invocation.providerOptions ?? {}) as DeterministicOptions;
    if (options.mode === "pending" || options.mode === "transient_failure" || options.mode === "terminal_failure") return { state: "pending", taskId: `det-${invocation.idempotencyKey}`, pollAfterMs: 10 };
    return { state: "completed", outputText: this.output(invocation, options.mode === "oversized") };
  }
  async check(taskId: string, invocation: AdapterInvocation) {
    const count = (this.checks.get(taskId) ?? 0) + 1; this.checks.set(taskId, count);
    const options = (invocation.providerOptions ?? {}) as DeterministicOptions;
    if (options.mode === "terminal_failure") return { state: "failed" as const, category: "provider_rejected" as const, retryable: false, safeMessage: "Deterministic terminal failure." };
    if (options.mode === "transient_failure" && invocation.attempt < 3) return { state: "failed" as const, category: "provider_unavailable" as const, retryable: true, safeMessage: "Deterministic transient failure." };
    if (count <= (options.pendingChecks ?? 0)) return { state: "pending" as const, pollAfterMs: 10 };
    return { state: "completed" as const, outputText: this.output(invocation) };
  }
  async cancel(_taskId: string, invocation: AdapterInvocation) { return ((invocation.providerOptions as DeterministicOptions | undefined)?.cancellation === "unsupported" ? "unsupported" : "cancelled") as "unsupported" | "cancelled"; }
}
