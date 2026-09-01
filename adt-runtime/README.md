# ADT Runtime

ADT Runtime is the independently deployed, stateless compute and provider-execution boundary for Artifact Dev Toolkit. It supports bounded conditional, parallel, and controlled-cycle LangGraph compute and one synchronous OpenAI Agents SDK invocation per accepted request. ADT retains Workflow admission, provider authority, retries, cancellation state, and durable history.

## Operator contract

- Deploy one `poulti/adt-runtime:latest` service using [`docker-stack.example.yml`](docker-stack.example.yml). An operator-managed updater such as Shepherd may roll refreshed `latest` images.
- The container is replaceable, runs as `node`, needs no persistent volume or Docker socket, and has no infrastructure control capability.
- Keep ingress HTTPS and operator-owned. The unauthenticated `/healthz` endpoint discloses only process health.
- Do not provision provider API keys, Cloudflare credentials, GitHub App credentials, artifact-repository credentials, Codex credentials, Portainer credentials, or tunnel credentials to this service.
- Do not add a D1 binding or persistent volume. Checkpoints remain in control-plane D1 behind a short-lived, exact run-scoped gateway authority.
- Trusted CI also publishes immutable `poulti/adt-runtime:<git-sha>` tags for provenance and explicit rollback/pinning if automatic `latest` rollout is suspended.

Create two external Docker secrets:

| Secret | Content |
| --- | --- |
| `adt_runtime_auth` | Dedicated high-entropy request-MAC secret, shared only with the Cloudflare application. |
| `adt_runtime_private_key` | PKCS#8 RSA private key used only to unwrap per-invocation AES keys. |

The Runtime derives the public SPKI fingerprint from the loaded PKCS#8 private key. There is no separately provisioned or trusted key-ID setting.

The Cloudflare application requires optional bindings `ADT_RUNTIME_BASE_URL`, `ADT_RUNTIME_AUTH_SECRET`, and `ADT_RUNTIME_WRAPPING_PUBLIC_KEY` (the PEM SPKI public key) for `openai-agents`. Tool-enabled Agents also require `ADT_TOOL_GATEWAY_URL`; tool-free Agents do not. Workflow v2 execution requires `ADT_CHECKPOINT_GATEWAY_URL` and `ADT_GRAPH_NODE_GATEWAY_URL`. Artifact-search, checkpoint, and graph-node gateway capabilities all use the single Worker-only `ADT_INTERNAL_AUTHORITY_SECRET`. It must never be provisioned to ADT Runtime and remains distinct from `ADT_RUNTIME_AUTH_SECRET`. If Runtime bindings are absent, Runtime-backed execution is unavailable while unrelated application functions continue. The wrapping private key never enters Cloudflare. Current provider credentials resolve from the ADT vault in the control plane and are encrypted to the Runtime only for an invocation. Retired credential sources are not current Runtime inputs.

Generate compatible material with standard OpenSSL commands:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out runtime-private.pem
openssl pkey -in runtime-private.pem -pubout -out runtime-public.pem
```

## Protocol and security

- Readiness separately advertises `openai-agents`, `tool:artifact-search`, `langgraph:graph`, and the optional `diagnostic:execution-path` capability; ADT rejects capability-specific execution before provider use when the required capability is absent.
- The authenticated execution-path diagnostic calls the exact checkpoint, graph-node, and optional Artifact Search gateway URLs supplied by the control plane. Each callback uses a separate, short-lived, target-scoped diagnostic authority and performs bounded schema-presence reads only. It never creates Workflow state, resolves credentials, invokes an Agent or provider, loads Artifacts, or accesses GitHub.
- The Worker-only `ADT_INTERNAL_AUTHORITY_SECRET` authenticates short-lived control-plane capabilities. Artifact-search authority remains scoped to the exact run attempt and repository snapshot; checkpoint authority remains run-scoped; graph-node authority remains bound to one run, node, graph activation, Workflow generation, iteration, and attempt. Token formats retain their separate purpose/audience and scope checks even though they share key material. Never provision this secret to Runtime or reuse `ADT_RUNTIME_AUTH_SECRET` for it.
- Protocol `adt-runtime-v1` exposes authenticated readiness, OpenAI Agents execution, and bounded conditional, parallel, and controlled-cycle LangGraph advance operations.
- One LangGraph advance reconstructs the immutable ADT plan, resumes the run thread through the remote saver, admits one bounded Agent frontier, checkpoints, and returns control to the outer Cloudflare Workflow.
- HMAC-SHA-256 binds protocol, method, exact path, millisecond timestamp, random nonce, and the SHA-256 digest of the exact body. Accepted nonces are retained in a bounded, expiring in-memory replay cache.
- Each credential uses a fresh AES-256-GCM key and nonce. RSA-OAEP with SHA-256 wraps that content key; GCM additional authenticated data binds protocol, capability, and ADT idempotency identity.
- Web Crypto implements RSA-OAEP, SHA-256, AES-GCM, and HMAC in both Cloudflare Workers and Node 24. The construction uses only those standard algorithms.
- Execution POSTs are never retried by the Runtime client. Lost or malformed post-execution outcomes are reported as non-retryable ambiguity.
- Runtime and application revisions need not match. Readiness advertises the independent image revision, protocol, capability, and wrapping-key identity; compatibility is explicit rather than an atomic-rollout assumption.
- Production images bake the trusted source revision at build time. The Swarm stack does not override it, so a Shepherd `latest` rollout automatically advertises the new image revision.

## Commissioning and troubleshooting

Commission without trial-running an Agent:

1. Confirm the container healthcheck is healthy.
2. Use **Test ADT Runtime** on the Connections page to confirm reachability.
3. Confirm request authentication is accepted.
4. Confirm the protocol is compatible.
5. Confirm the `openai-agents` capability is present.
6. Confirm the configured public wrapping key matches the Runtime private key.
7. On the unified Diagnostics page, explicitly select **Test execution path** to verify the Runtime can call the configured checkpoint and graph-node gateways and, when configured, the optional Artifact Search gateway.
8. Run the separate provider **Test connection** diagnostic for the credential and model.
9. Only after the applicable diagnostics pass, try a real `openai-agents` Workflow.

Passive readiness states distinguish startup configuration failure, ingress/runtime unreachable, request-authentication mismatch, protocol mismatch, missing capability, and wrapping-key mismatch. The operator-triggered execution-path diagnostic is non-mutating and reports callback reachability, diagnostic-authority acceptance, and required local backend availability per gateway. Provider Connection Test separately identifies provider credential failures. Real execution can report provider timeout, rate limiting, rejection, or unavailability. A lost or malformed response after execution dispatch remains non-retryable ambiguity because provider work may have occurred.

Runtime logs are structured safe JSON events. Use their stage, result, HTTP status, correlation ID, duration, and `providerExecutionEntered` fields; never print or compare secret values while troubleshooting.
