# ADT Runtime

ADT Runtime is the independently deployed, stateless provider-execution boundary for Artifact Dev Toolkit. It runs one synchronous OpenAI Agents SDK invocation per accepted request. ADT retains Workflow admission, sequencing, retries, cancellation state, and durable history.

## Operator contract

- Deploy one `poulti/adt-runtime:latest` service using [`docker-stack.example.yml`](docker-stack.example.yml). An operator-managed updater such as Shepherd may roll refreshed `latest` images.
- The container is replaceable, runs as `node`, needs no persistent volume or Docker socket, and has no infrastructure control capability.
- Keep ingress HTTPS and operator-owned. The unauthenticated `/healthz` endpoint discloses only process health.
- Do not provision provider API keys, Cloudflare credentials, GitHub App credentials, artifact-repository credentials, Codex credentials, Portainer credentials, or tunnel credentials to this service.
- Trusted CI also publishes immutable `poulti/adt-runtime:<git-sha>` tags for provenance and explicit rollback/pinning if automatic `latest` rollout is suspended.

Create three external Docker secrets:

| Secret | Content |
| --- | --- |
| `adt_runtime_auth` | Dedicated high-entropy request-MAC secret, shared only with the Cloudflare application. |
| `adt_runtime_private_key` | PKCS#8 RSA private key used only to unwrap per-invocation AES keys. |
| `adt_runtime_key_id` | Base64url SHA-256 fingerprint of the matching public-key SPKI DER. |

The Cloudflare application requires optional bindings `ADT_RUNTIME_BASE_URL`, `ADT_RUNTIME_AUTH_SECRET`, and `ADT_RUNTIME_WRAPPING_PUBLIC_KEY` (the PEM SPKI public key). If any are absent, only `openai-agents` execution is unavailable; unrelated application functions continue. The wrapping private key never enters Cloudflare. Existing provider credentials remain in the current Cloudflare secret bindings or transitional encrypted D1 state and are encrypted to the Runtime only for an invocation.

Generate compatible material with standard OpenSSL commands:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out runtime-private.pem
openssl pkey -in runtime-private.pem -pubout -out runtime-public.pem
openssl pkey -pubin -in runtime-public.pem -outform DER |
  openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='
```

## Protocol and security

- Protocol `adt-runtime-v1` exposes authenticated `GET /v1/readiness` and `POST /v1/executions/openai-agents` operations.
- HMAC-SHA-256 binds protocol, method, exact path, millisecond timestamp, random nonce, and the SHA-256 digest of the exact body. Accepted nonces are retained in a bounded, expiring in-memory replay cache.
- Each credential uses a fresh AES-256-GCM key and nonce. RSA-OAEP with SHA-256 wraps that content key; GCM additional authenticated data binds protocol, capability, and ADT idempotency identity.
- Web Crypto implements RSA-OAEP, SHA-256, AES-GCM, and HMAC in both Cloudflare Workers and Node 24. The construction uses only those standard algorithms.
- Execution POSTs are never retried by the Runtime client. Lost or malformed post-execution outcomes are reported as non-retryable ambiguity.
- Runtime and application revisions need not match. Readiness advertises the independent image revision, protocol, capability, and wrapping-key identity; compatibility is explicit rather than an atomic-rollout assumption.
