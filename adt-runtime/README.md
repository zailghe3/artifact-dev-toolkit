# ADT Runtime

ADT Runtime is the independently deployed, stateless compute and provider-execution boundary for Artifact Dev Toolkit. It supports linear LangGraph compute and one synchronous OpenAI Agents SDK invocation per accepted request. ADT retains Workflow admission, provider authority, retries, cancellation state, and durable history.

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

The Cloudflare application requires optional bindings `ADT_RUNTIME_BASE_URL`, `ADT_RUNTIME_AUTH_SECRET`, and `ADT_RUNTIME_WRAPPING_PUBLIC_KEY` (the PEM SPKI public key) for `openai-agents`. Tool-enabled Agents also require `ADT_TOOL_GATEWAY_URL` and the Worker-only `ADT_TOOL_AUTHORITY_SECRET`; tool-free Agents do not. Workflow v2 execution requires `ADT_CHECKPOINT_GATEWAY_URL`, `ADT_GRAPH_NODE_GATEWAY_URL`, and the distinct Worker-only `ADT_CHECKPOINT_AUTHORITY_SECRET` and `ADT_GRAPH_NODE_AUTHORITY_SECRET`. Authority secrets must never be provisioned to ADT Runtime. If Runtime bindings are absent, Runtime-backed execution is unavailable while unrelated application functions continue. The wrapping private key never enters Cloudflare. Existing provider credentials remain in the current Cloudflare secret bindings or transitional encrypted D1 state and are encrypted to the Runtime only for an invocation.

Generate compatible material with standard OpenSSL commands:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out runtime-private.pem
openssl pkey -in runtime-private.pem -pubout -out runtime-public.pem
```

## Protocol and security

- Readiness separately advertises `openai-agents`, `tool:artifact-search`, and `langgraph:linear`; ADT rejects capability-specific execution before provider use when the required capability is absent.
- The Worker-only `ADT_CHECKPOINT_AUTHORITY_SECRET` and `ADT_GRAPH_NODE_AUTHORITY_SECRET` issue distinct short-lived run-scoped checkpoint and Agent-node capabilities. Never provision them to Runtime or reuse Runtime request-authentication or artifact-search authority material.
- Protocol `adt-runtime-v1` exposes authenticated readiness, OpenAI Agents execution, and bounded linear LangGraph advance operations.
- One LangGraph advance reconstructs the immutable ADT plan, resumes the run thread through the remote saver, admits at most one Agent node, checkpoints, and returns control to the outer Cloudflare Workflow.
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
7. Run the separate provider **Test connection** diagnostic for the credential and model.
8. Only after both diagnostics pass, try a real `openai-agents` Workflow.

Safe diagnostic states distinguish startup configuration failure, ingress/runtime unreachable, request-authentication mismatch, protocol mismatch, missing capability, and wrapping-key mismatch. Provider Connection Test separately identifies provider credential failures. Real execution can report provider timeout, rate limiting, rejection, or unavailability. A lost or malformed response after execution dispatch remains non-retryable ambiguity because provider work may have occurred.

Runtime logs are structured safe JSON events. Use their stage, result, HTTP status, correlation ID, duration, and `providerExecutionEntered` fields; never print or compare secret values while troubleshooting.
