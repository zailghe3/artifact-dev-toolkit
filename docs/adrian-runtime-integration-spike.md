# Adrian Runtime integration spike

## Purpose

- This spike tests a Runtime-only Adrian security observer and gate boundary.
- It is not the production Adrian feature or a production failure policy.
- Normal Runtime execution remains Adrian-independent because the adapter is only constructed and injected by the focused harness.

## Tested SDKs and public APIs

- `@openai/agents` **0.17.0** and its existing `openai` **7.5.0** dependency path were tested without upgrades.
- `@secureagentics/adrian` **1.1.0** is pinned in `adt-runtime` only.
- ADT decorates the public Agents SDK `ModelProvider.getModel()` result and the public `Model.getResponse()` method. It does not intercept HTTP.
- The non-streaming model decorator observes `ModelRequest` and `ModelResponse`, including normalized output items, provider tool-call IDs, and normalized token usage.
- The adapter uses Adrian core's public `init`, `shutdown`, `getHandler`, `getWebSocketClient`, `AdrianCallbackHandler.handleChatModelStart`, `handleLLMEnd`, `handleLLMError`, `handleToolStart`, `handleToolEnd`, `handleToolError`, and `gateToolCallIds` APIs.
- The test backend exchanges Adrian's real protobuf WebSocket frames with the real core package. No managed Adrian service or API key is required.

## Observed integration behavior

- One ADT Agent node execution/model conversation should map to one Adrian session. Stable ADT turn IDs and original provider tool-call IDs nest below that session.
- The model decorator emits the model-visible instructions and input before a turn, then output, proposed calls, call IDs, and usage after the turn.
- Agents SDK 0.17.0 passes the original function-call ID through the public tool callback `details.toolCall.callId`.
- The generic `ToolSecurityGate` receives that ID with the tool name and arguments. The Adrian adapter reports tool start before execution and tool result/error after execution.
- The existing order is: Agent/tool grant construction, global tool-call budget consumption, security-gate authorization, then Artifact Search or MCP execution. A denied call consumes budget but does not invoke the underlying side effect.
- Pre-execution `authorize()` is the authoritative enforcement hook. Post-execution `completed()` and `failed()` callbacks are observational; reporting failures cannot change an already-established tool result, mask the original error, or invite replay of a completed side effect.
- A real BLOCK-mode `M3` verdict is observable as `gateToolCallIds()` returning `block/policy_halt`; the adapter can deny before the tool implementation runs.
- An explicit non-halting verdict allows the implementation exactly once.
- Existing MCP transport ambiguity and no-retry behavior is below the unchanged generic gate and is unaffected.

## Timeout and availability finding

- Adrian core 1.1.0's public `GateToolCallsResult` type includes `block/verdict_timeout`, but the tested `gateToolCallIds()` implementation does not return that result when a verdict wait expires.
- A verdict timeout returns `allow`. Failure to establish policy readiness and a disconnected backend also return `allow`.
- Consequently, the high-level gate result cannot distinguish **allow**, **verdict timeout**, and **backend unavailable**. An explicit policy halt remains distinguishable as **deny**.
- Public lower-level `WebSocketClient.waitForToolCallVerdict()` returns `null` for a missing mapping or elapsed wait, while `waitForPolicyReady()` returns `false` for multiple readiness failures. Disconnect callbacks are advisory and do not make all races distinguishable.
- Adrian therefore fails open on verdict timeout in this tested integration. The spike does not treat that outcome as positive ADT security approval and does not enable the gate in production.
- ADT could conservatively fail closed on every public `null`/not-ready result, but it could not report the required timeout and backend-unavailable states reliably. A production four-outcome contract needs an Adrian SDK API that returns explicit allow, deny, timeout, and unavailable states (or a supported lower-level transport contract with equivalent semantics).

## Security and packaging boundaries

- OpenAI requests still use ADT's existing `OpenAIProvider` and direct OpenAI client. Adrian is an independent observer; it is not a provider or transport.
- `@secureagentics/adrian-openai`, `adrian.openai()`, OpenAI client wrapping, HTTP interception, and SDK monkey-patching are absent.
- Only model-visible context, model output, normalized usage, tool identity, tool arguments, tool result, and ADT/provider correlation IDs enter Adrian events.
- Provider credentials, Artifact Search authority, MCP bearer credentials, encrypted envelopes, vault IDs, GitHub credentials, and Cloudflare authority tokens are not supplied to the adapter.
- `@secureagentics/adrian` is an `adt-runtime` dependency only. The root/Cloudflare Worker dependency graph and bundle do not include Adrian.
- Shutdown closes handlers and WebSocket state and clears Adrian's process-global registry. Because Adrian 1.1.0 uses process-global initialization, production use also needs request/session isolation or an SDK instance API before concurrent sessions are enabled.

## Recommended production shape

- Keep OpenAI transport owned by ADT and decorate the provider-independent `ModelProvider`/`Model` boundary.
- Keep one ADT-owned adapter responsible for Adrian event conversion and lifecycle.
- Preserve ADT authorization and the global budget before an Adrian-backed generic `ToolSecurityGate`; Adrian may only further restrict granted tools.
- Keep Artifact Search and MCP unaware of Adrian and report results through generic gate lifecycle callbacks.
- Add product configuration, secret management, an explicit four-outcome failure policy, concurrency-safe Adrian sessions, operational diagnostics, and durable review behavior only in a subsequent production implementation.
- Resolve the Adrian verdict-outcome and instance-isolation SDK gaps before enabling production blocking.
