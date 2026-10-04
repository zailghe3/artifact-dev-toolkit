# ADT Runtime

ADT Runtime is the independently deployed compute and provider-execution boundary for Artifact Dev Toolkit. It performs bounded LangGraph progression and execution-heavy provider work while ADT keeps durable Workflow state, admission, credentials, retries/cancellation policy, and recorded outcomes.

## Design boundary

- Runtime has no durable application state, D1 binding, Docker socket, or broad infrastructure-control credential. It may hold only the four operator-provisioned, service-scoped Portainer redeploy webhook URLs described below.
- LangGraph sequencing runs in Runtime, but durable checkpoints remain behind a control-plane gateway and executable Agent-node admission remains a separate control-plane authority.
- Runtime does not own broad repository, Cloudflare, GitHub App, Codex, Portainer API, or artifact-repository credentials.
- Provider credentials are resolved in the control plane and encrypted to Runtime only for the exact invocation that needs them. Runtime does not persist them.
- Runtime may keep bounded ephemeral process state needed for protocol safety, such as replay protection, but replacement requires no local durable application volume.
- Execution-heavy AI/provider libraries that do not require broad control-plane authority belong here; control-plane-only policy and privileged mutation do not.
- Application and Runtime revisions may roll independently through an explicit protocol/capability contract.
- Runtime owns bounded remote MCP Streamable HTTP discovery and calls. MCP credentials are optional invocation-scoped encrypted bearer values and are never persisted.
- Agent execution registers only control-plane-authorised frozen MCP definitions. Deterministic `mcp_<remote prefix>_<identity digest>` aliases prevent server/tool collisions while calls retain the original remote name; MCP and built-in tools share one security gate and call budget.

## Operator contract

- Deploy `poulti/adt-runtime:latest` using [`docker-stack.example.yml`](docker-stack.example.yml) or pin an immutable `poulti/adt-runtime:<git-sha>` image for explicit rollout/rollback.
- Run the container as the non-root `node` user with no persistent application volume or Docker socket.
- Adrian 1.1.0 installs a JSONL handler during SDK initialization. Runtime routes that output to an isolated container temporary directory and removes it after each Adrian lifecycle; `/runtime` remains non-writable to the runtime user. This local JSONL output is neither retained nor used as ADT's authoritative security evidence.
- Keep ingress HTTPS and operator-owned. The unauthenticated `/healthz` endpoint discloses only process health.
- Do not provision provider API keys, Cloudflare credentials, GitHub App credentials, artifact-repository credentials, Codex credentials, Portainer API credentials, Docker access, or tunnel credentials to Runtime.
- Trusted CI publishes immutable Git-SHA tags plus `latest`; deployment remains operator-owned.

Create two external Docker secrets:

| Secret | Content |
| --- | --- |
| `adt_runtime_auth` | Dedicated high-entropy request-authentication secret shared only with the Cloudflare application. |
| `adt_runtime_private_key` | PKCS#8 RSA private key used to unwrap per-invocation credential keys. |

Footer maintenance is optional. The stack example maps these external secrets to stable Runtime secret files; each value is the full operator-owned private webhook URL:

- `ADT_Runtime_Redeploy_Webhook`
- `Codex_Runner_Controller_Redeploy_Webhook`
- `Codex_Runner_Executor_Redeploy_Webhook`
- `Codex_Runner_Repository_Manager_Redeploy_Webhook`

Runtime updates are available only with the Runtime webhook. Runner updates require all three Runner webhooks. Missing or invalid optional values do not prevent Runtime startup or unrelated operations. Runtime calls these fixed endpoints directly with bounded, non-redirecting requests; the application sends only the fixed `runtime` or `runner` target. Webhook URLs never enter Cloudflare, browser state, readiness, diagnostics, responses, or logs. The existing independently mounted Executor secret in the Runner Controller remains the emergency hard-restart path.

The first rollout requires an operator to deploy the new Runtime image and mount all four secrets manually. An older Runtime advertises no redeploy capability, so the application fails safely with manual-update guidance rather than falling back to Portainer access. Portainer remains private and must not be added to the Cloudflare tunnel.

The Runtime derives the public-key fingerprint from the loaded private key. The matching public SPKI key is configured in the Cloudflare application; the private key never enters Cloudflare.

Generate compatible key material with:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out runtime-private.pem
openssl pkey -in runtime-private.pem -pubout -out runtime-public.pem
```

## Cloudflare configuration

`ADT_RUNTIME_BASE_URL`, `ADT_RUNTIME_AUTH_SECRET`, and `ADT_RUNTIME_WRAPPING_PUBLIC_KEY` define the Runtime connection/security boundary. If they are absent, Runtime-backed execution is unavailable while unrelated application functions continue.

Workflow graph execution additionally uses the configured checkpoint and graph-node gateway URLs. Tool-enabled Agents may also require the Artifact Search gateway. These gateways use Worker-only authority material that must never be provisioned to Runtime or reused as the Runtime request-authentication secret.

Current provider credentials resolve only from the ADT vault in the control plane. Retired credential sources are not current Runtime inputs.

## Protocol and execution semantics

- Readiness advertises protocol compatibility, supported execution capabilities, image revision, and wrapping-key identity. Exact capability identifiers and payload schemas are authoritative in source and tests.
- Runtime requests are authenticated and replay-protected; malformed, stale, replayed, incompatible, or unsupported requests fail closed before provider work.
- MCP endpoints are restricted to safe public HTTPS destinations in normal operation. Connections use only policy-validated DNS answers, and redirects remain bounded to the same origin with destination validation repeated. A narrow explicit localhost mode exists only for deterministic development and tests.
- MCP discovery exposes bounded catalogue metadata. MCP calls consume a caller-selected frozen schema, map remote failures to safe errors, and are never automatically retried after dispatch.
- One LangGraph advance reconstructs the frozen ADT plan, resumes through the remote checkpoint boundary, admits a bounded executable frontier through the control plane, checkpoints, and returns control to the outer Cloudflare Workflow.
- Checkpoint and Agent-node callbacks carry only narrowly scoped authority for the exact run/action being performed. Runtime never receives the Worker-only authority secret itself.
- `openai-agents` executes one bounded synchronous provider invocation. Agent-configured execution timeout is the only user-facing timeout; transport and HTTP-server ceilings are derived/internal safety bounds.
- Graph progression is designed to be recoverable through durable checkpoints and idempotent control-plane admission.
- A synchronous provider invocation whose outcome becomes ambiguous after provider entry is not blindly replayed because there is no durable provider task identity to reconcile.
- Runtime and callback failures use bounded, validated, non-sensitive evidence so the application can distinguish Runtime transport from checkpoint/graph-node boundary failures without persisting raw upstream data.

Exact cryptographic construction, wire fields, nonce handling, byte limits, timeout constants, and internal retry mechanics remain authoritative in source and tests.

## Diagnostics and commissioning

Commission Runtime without trial-running a provider invocation:

1. Confirm the container healthcheck is healthy.
2. Use **Test ADT Runtime** to confirm reachability, request authentication, protocol compatibility, required capabilities, and wrapping-key compatibility.
3. On the unified Diagnostics page, explicitly run **Test execution path** when Workflow execution is being commissioned. It verifies Runtime-to-gateway reachability with narrow diagnostic authority and performs no provider work or Workflow mutation.
4. Run the separate provider **Test connection** for the credential/model.
5. Only after the applicable checks pass, run a real Workflow.

The execution-path diagnostic is non-mutating: it does not create Workflow/checkpoint state, resolve provider credentials, invoke an Agent/provider, search Artifact contents, or access GitHub.

Passive readiness, execution-path readiness, provider connection readiness, and real provider execution are separate conditions and should remain separately diagnosable.

Runtime logs are structured safe events. Use bounded stage/result/status/correlation/duration fields; do not log or compare secret values, provider payloads, prompts, callback bodies, or raw exception text.

## Release identity

- `/runtime/REVISION` is the immutable image/source Git SHA used for operator identity.
- `release.json` is the source-controlled monotonic Runtime release generation shared with the Worker.
- Readiness reports both facts. The Worker compares release generations for freshness and never infers freshness from Git history, SHA equality, GitHub, or Docker Hub.
- Runtime image-input changes must increment `releaseRevision` in the same pull request; CI validates this policy.
