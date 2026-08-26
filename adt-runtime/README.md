# ADT Runtime

ADT Runtime is the independently deployed, stateless provider-execution boundary for Artifact Dev Toolkit. It runs one synchronous OpenAI Agents SDK invocation per accepted request. ADT retains Workflow admission, sequencing, retries, cancellation state, and durable history.

## Operator contract

- Deploy one `poulti/adt-runtime:latest` service using [`docker-stack.example.yml`](docker-stack.example.yml). An operator-managed updater such as Shepherd may roll refreshed `latest` images.
- The container is replaceable, runs as `node`, needs no persistent volume or Docker socket, and has no infrastructure control capability.
- Keep ingress HTTPS and operator-owned. The unauthenticated `/healthz` endpoint discloses only process health.
- Do not provision provider API keys, Cloudflare credentials, GitHub App credentials, artifact-repository credentials, Codex credentials, Portainer credentials, or tunnel credentials to this service.
- Trusted CI also publishes immutable `poulti/adt-runtime:<git-sha>` tags for provenance and explicit rollback/pinning if automatic `latest` rollout is suspended.

Create two external Docker secrets:

| Secret | Content |
| --- | --- |
| `adt_runtime_auth` | Dedicated high-entropy request-MAC secret, shared only with the Cloudflare application. |
| `adt_runtime_private_key` | PKCS#8 RSA private key used only to unwrap per-invocation AES keys. |

The Runtime derives the public SPKI fingerprint from the loaded PKCS#8 private key. There is no separately provisioned or trusted key-ID setting.

The Cloudflare application requires optional bindings `ADT_RUNTIME_BASE_URL`, `ADT_RUNTIME_AUTH_SECRET`, and `ADT_RUNTIME_WRAPPING_PUBLIC_KEY` (the PEM SPKI public key). If any are absent, only `openai-agents` execution is unavailable; unrelated application functions continue. The wrapping private key never enters Cloudflare. Existing provider credentials remain in the current Cloudflare secret bindings or transitional encrypted D1 state and are encrypted to the Runtime only for an invocation.

Generate compatible material with standard OpenSSL commands:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out runtime-private.pem
openssl pkey -in runtime-private.pem -pubout -out runtime-public.pem
```

## Protocol and security

- Protocol `adt-runtime-v1` exposes authenticated `GET /v1/readiness` and `POST /v1/executions/openai-agents` operations.
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
