# ADT Runtime

ADT Runtime owns Workflow execution and operational state for Artifact Dev Toolkit. The Cloudflare Worker handles browser sessions, user authorisation, Git-backed admission and scoped GitHub authority.

## Design boundary

- Runtime schedules, resumes and cancels complete Workflows. PostgreSQL persists runs, approvals, attempts, tool journals, LangGraph checkpoints, settings and registrations.
- Runtime resolves credentials from its repository-scoped encrypted vault. Work IQ OAuth exchanges and refresh tokens stay in Runtime. The Worker handles the browser redirect.
- The Worker keeps GitHub App signing credentials. Its signed broker mints short-lived GitHub installation tokens scoped to the configured artifact repository or an admitted managed repository operation.
- Runtime owns bounded remote MCP discovery and execution. Frozen tool contracts share the ADT approval, policy and security gate.
- Codex Runner owns Codex identity and isolated execution. Runtime holds only credentials needed to call its service.
- Runtime and Worker authenticate requests and negotiate protocol capabilities. PostgreSQL persists replay protection for signed operational requests.

## Operator contract

- Deploy `poulti/adt-runtime:latest` using the base [`docker-stack.example.yml`](docker-stack.example.yml) or pin an immutable `poulti/adt-runtime:<git-sha>` image for explicit rollout/rollback. The base stack requires no redeploy webhook secrets.
- Run the container as the non-root `node` user with its dedicated, persistent key directory. Keep the Docker socket outside Runtime.
- Adrian 1.1.0 installs a JSONL handler during SDK initialization. Runtime routes that output to an isolated container temporary directory and removes it after each Adrian lifecycle; `/runtime` remains non-writable to the runtime user. This local JSONL output is neither retained nor used as ADT's authoritative security evidence.
- Keep ingress HTTPS and operator-owned. The unauthenticated `/healthz` endpoint discloses only process health.
- Do not provision provider API keys, Cloudflare credentials, GitHub App credentials, artifact-repository credentials, Codex credentials, Portainer API credentials, Docker access, or tunnel credentials to Runtime.
- Trusted CI publishes immutable Git-SHA tags plus `latest`; deployment remains operator-owned.

Create the external Docker secrets listed in the [cutover guide](../docs/runtime-postgresql.md).

| Secret | Content |
| --- | --- |
| `adt_runtime_auth` | Dedicated high-entropy request-authentication secret shared only with the Cloudflare application. |

Footer maintenance uses four additional optional external Docker secrets. Opt in by combining the base stack with [`docker-stack.maintenance.example.yml`](docker-stack.maintenance.example.yml); the maintenance overlay maps them to stable Runtime secret files. Each value is the full operator-owned private webhook URL:

- `ADT_Runtime_Redeploy_Webhook`
- `Codex_Runner_Controller_Redeploy_Webhook`
- `Codex_Runner_Executor_Redeploy_Webhook`
- `Codex_Runner_Repository_Manager_Redeploy_Webhook`

Runtime updates are available only with the Runtime webhook. Runner updates require all three Runner webhooks. Missing or invalid optional values do not prevent Runtime startup or unrelated operations. Runtime calls these fixed endpoints directly with bounded, non-redirecting requests; the application sends only the fixed `runtime` or `runner` target. Webhook URLs never enter Cloudflare, browser state, readiness, diagnostics, responses, or logs. The existing independently mounted Executor secret in the Runner Controller remains the emergency hard-restart path.

Deploy the maintenance-enabled configuration only after all four external secrets exist:

```sh
docker stack deploy -c docker-stack.example.yml -c docker-stack.maintenance.example.yml adt-runtime
```

The Runtime and split Runner stacks independently mount the same external `Codex_Runner_Executor_Redeploy_Webhook`. Runner Controller uses its local `executor_redeploy_webhook` alias only for emergency hard restart; Runtime uses its own mount only as the Executor step of the fixed Runner maintenance action. No duplicate credential or copied secret value is required.

The first rollout requires an operator to deploy the new Runtime image and mount all four secrets manually. An older Runtime advertises no redeploy capability, so the application fails safely with manual-update guidance rather than falling back to Portainer access. Portainer remains private and must not be added to the Cloudflare tunnel.

## PostgreSQL deployment

Runtime requires PostgreSQL and initializes the operational schema before it reports ready. Use the [Runtime-only stack](docker-stack.existing-postgres.example.yml) with an existing service, or the [standalone stack](docker-stack.example.yml) for a new private PostgreSQL service. Both use a separate Runtime key export. Runtime provisions both its vault and wrapping keys. Follow the [cutover and restore guide](../docs/runtime-postgresql.md) before deploying the Worker.

## Cloudflare configuration

Configure `ADT_RUNTIME_BASE_URL` and the shared `ADT_RUNTIME_AUTH_SECRET` on the Worker. Configure `ADT_RUNTIME_WORKER_URL` on Runtime for the scoped GitHub broker. Authenticated readiness provides the wrapping public key and its fingerprint.

## Protocol and execution semantics

- Readiness advertises protocol compatibility, supported execution capabilities, image revision, and wrapping-key identity. Exact capability identifiers and payload schemas are authoritative in source and tests.
- Runtime requests are authenticated and replay-protected; malformed, stale, replayed, incompatible, or unsupported requests fail closed before provider work.
- MCP endpoints are restricted to safe public HTTPS destinations in normal operation. Connections use only policy-validated DNS answers, and redirects remain bounded to the same origin with destination validation repeated. A narrow explicit localhost mode exists only for deterministic development and tests.
- MCP discovery exposes bounded catalogue metadata. MCP calls consume a caller-selected frozen schema, map remote failures to safe errors, and are never automatically retried after dispatch.
- Runtime advances one bounded LangGraph frontier at a time. Each PostgreSQL lease has a generation and fence. A replacement Runtime can take over expired work, and the previous owner cannot commit stale state.
- Approvals persist across restarts. Runtime reads durable decisions when a run is due or an authenticated command wakes it.
- Provider and tool attempts are journaled before dispatch. Provider task IDs support polling and cancellation where available. Ambiguous synchronous outcomes stay recorded for reconciliation.
- Graph progression and provider execution have separate deadlines. Transport and repository broker failures use bounded diagnostics.
- The legacy OpenAI Agents HTTP operation remains an alias of the same executor. A PostgreSQL-backed Runtime schedules Workflow graphs internally.

Exact cryptographic construction, wire fields, nonce handling, byte limits, timeout constants, and internal retry mechanics remain authoritative in source and tests.

## Diagnostics and commissioning

Commission Runtime without trial-running a provider invocation:

1. Confirm the container healthcheck is healthy.
2. Use **Test ADT Runtime** to confirm reachability, request authentication, protocol compatibility, required capabilities, and wrapping-key compatibility.
3. On the unified Diagnostics page, explicitly run **Test execution path** when Workflow execution is being commissioned. It verifies the PostgreSQL tables and the scoped GitHub broker without invoking providers or mutating a Workflow.
4. Run the separate provider **Test connection** for the credential/model. Provider commissioning runs in Runtime. The Worker receives safe connection status and diagnostics.
5. Only after the applicable checks pass, run a real Workflow.

The execution-path diagnostic is non-mutating: it does not create Workflow/checkpoint state, resolve provider credentials, invoke an Agent/provider, or search Artifact contents. The broker check mints a scoped read credential.

Passive readiness, execution-path readiness, provider connection readiness, and real provider execution are separate conditions and should remain separately diagnosable.

Runtime logs are structured safe events. Use bounded stage/result/status/correlation/duration fields; do not log or compare secret values, provider payloads, prompts, callback bodies, or raw exception text.

For a journaled Agent failure, use the inspector's client request ID to find the Runtime receipt, provider entry, and completion or failure events. A missing response or log entry leaves provider execution unconfirmed.

## Ollama endpoints and model commissioning

- Configure `ADT_RUNTIME_OLLAMA_ALLOWED_BASE_URLS` with up to 32 comma-separated origin URLs, for example `http://ollama:11434,https://ollama.com`. The default empty list permits no Ollama endpoint.
- The Worker and Runtime share strict base-URL normalization: HTTP/HTTPS only, no embedded credentials, query, fragment, or non-root path. Trailing `/` is removed. Malformed operator configuration prevents startup; endpoint lists are never logged or exposed by readiness.
- Every discovery and execution checks an exact normalized allowlist match before network access. Scheme, host, and port must match. Private network access is intentional only for operator-approved endpoints; MCP's public-internet-only policy does not apply.
- Runtime appends `/api/tags` for read-only discovery, `/api/show` for model tool-capability checks and `/api/chat` for bounded non-streaming model turns. Redirects are disabled, responses are bounded, and requests are never automatically retried. No model pull/create/delete operation is exposed.
- Localhost refers to Runtime's own process/container. Use the appropriate Docker service name, host gateway, LAN address, or routed hostname, and provide network connectivity separately. This feature does not deploy Ollama.
- Select None for an ordinary unauthenticated local server. The official direct-cloud origin `https://ollama.com` requires Bearer API key authentication; None is rejected before discovery, saving, or execution. Custom endpoints may use None or Bearer, including custom HTTPS endpoints. Select Bearer for an authenticated reverse proxy. Runtime uses a call-scoped credential resolved from the ADT vault; do not provision an Ollama API key as a Runtime environment variable.
- Authenticated `POST /v1/providers/models` uses the additive `provider-model-discovery` capability and a strict `ollama-chat` branch. It carries only correlation identity, safe connection configuration, and an optional encrypted credential. It never receives a prompt, Workflow state, tools, or repository authority.
- Readiness advertises `ollama-chat`, generic provider execution, and provider model discovery independently of allowlist contents. Missing capability and rejected endpoint configuration are distinct failures; an empty allowlist does not hide protocol support.
- Deploy Runtime release 8 or later and configure the allowlist before commissioning Ollama. In the application, create an Ollama connection, load available models, select an advertised model, and save. Use **Test connection** to recheck that model through Runtime without inference. Use **Test ADT Runtime** separately for the Runtime boundary.
- Old Workers retain existing execution endpoints and capabilities, including the legacy OpenAI alias. New Workers fail closed for Ollama on an older Runtime, with no direct Cloudflare fallback. Deploy Runtime before enabling provider discovery and validation in the Worker.

## Release identity

- `/runtime/REVISION` is the immutable image/source Git SHA used for operator identity.
- `release.json` is the source-controlled monotonic Runtime release generation shared with the Worker.
- Readiness reports both facts. The Worker compares release generations for freshness and never infers freshness from Git history, SHA equality, GitHub, or Docker Hub.
- Runtime image-input changes must increment `releaseRevision` in the same pull request; CI validates this policy.

The first PostgreSQL release publishes a verified Runtime image while automatic Worker deployment waits for the operator cutover. Once the operator enables `ADT_POSTGRES_CUTOVER_READY`, the normal main lifecycle resumes. See the [cutover guide](../docs/runtime-postgresql.md).

## Durable Agent tool contract

- Release 10 advertises `agent:progress-v1`. `/v1/agents/progress` performs one model turn without tool credentials or execution authority. `/v1/agents/security` reconstructs exact-call Adrian context. `/v1/agents/tool` performs one exact admitted MCP invocation.
- Each operation uses the existing authenticated, replay-protected transport and invocation-scoped credential wrapping. Model and tool credentials are never interchangeable durable state.
- OpenAI uses the pinned SDK public model API with a no-op trace and Chat Completions. Anthropic and Ollama retain native protocol adapters. No provider executes a tool through an SDK Runner.
- Runtime persists proposals, approvals, budget counters, results and conversations in PostgreSQL.
- MCP uncertainty crosses the wire explicitly. Missing results are not interpreted as non-execution.
- Admitted tool requests carry an absolute execution deadline. MCP bounds the complete operation, preserves transport cancellation and rejects expired dispatch grants before network access.
- See [Agent tools and recovery](../docs/agent-tools-and-recovery.md) for the complete state machine, provider/schema limits, roles, journal inspection, reconciliation and required coordinated cutover. Follow the PostgreSQL cutover guide for the initial drain and deployment.
