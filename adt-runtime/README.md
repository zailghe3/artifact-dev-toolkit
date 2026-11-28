# ADT Runtime

ADT Runtime is Artifact Dev Toolkit's durable execution and private-service plane. The Cloudflare Worker remains the thin public control plane for browser sessions, user/repository authorisation, Git-backed admission, and GitHub App authority.

## Design boundary

- Runtime schedules, resumes, cancels, and recovers complete Workflows.
- PostgreSQL persists Conversations and their Run links, Workflow runs, checkpoints, attempts, approvals, tool journals, response actions, operational settings, and the encrypted repository-scoped credential vault.
- Runtime resolves provider/tool credentials for the exact admitted operation; credential values do not enter Git-authored definitions or browser state.
- Runtime hosts execution-heavy provider, tool, and security integrations and is the preferred boundary for capabilities that need private/homelab network access.
- The Worker retains broad GitHub App signing authority and brokers only short-lived repository credentials required by an admitted Runtime operation.
- Codex Runner remains a separate trust boundary for Codex identity, model-directed command execution, and managed Git authority.
- Runtime and Worker authenticate their service boundary and negotiate compatibility explicitly.

Runtime may own narrowly scoped infrastructure capabilities needed to operate services in its private environment. Those capabilities must remain in Runtime or another purpose-specific trusted homelab service rather than being transferred to Cloudflare or the browser.

## Operator contract

- Deploy `poulti/adt-runtime:latest` for normal tracked rollout or pin an immutable `poulti/adt-runtime:<git-sha>` image for explicit rollout/rollback.
- Use the committed stack examples as the operator baseline; exact image pins, mounts, resource limits, network names, and healthcheck mechanics remain authoritative there.
- Run Runtime as the non-root image user with a persistent protected Runtime key directory.
- Keep the Docker socket and broad infrastructure credentials outside Runtime.
- Keep ingress HTTPS and operator-owned. The unauthenticated `/healthz` endpoint exposes process health only.
- Trusted CI publishes immutable source-SHA images plus `latest`; deployment and private infrastructure remain operator-owned.

Runtime requires the external secrets and configuration documented in [PostgreSQL operations](../docs/runtime-postgresql.md). The shared `adt_runtime_auth` secret authenticates Worker/Runtime requests.

### Optional maintenance control

Footer maintenance may be enabled by combining the base stack with `docker-stack.maintenance.example.yml`.

- Runtime may receive only the fixed private webhook URLs for the Runtime and split Runner services it is allowed to request redeployment for.
- The browser/Worker sends a fixed component target, not an arbitrary infrastructure URL.
- Webhook URLs remain Runtime-only and are excluded from readiness, diagnostics, responses, and logs.
- Missing maintenance webhooks do not prevent Runtime startup or unrelated execution.
- Portainer/Docker authority remains private and is not added to the public Cloudflare boundary.

The same Executor redeploy secret may be mounted independently by Runner Controller for emergency hard restart and by Runtime for the explicit Runner maintenance action; each component uses it only for its own bounded purpose.

## PostgreSQL and key material

Runtime requires PostgreSQL and initializes/validates its operational schema before reporting ready.

- Use `docker-stack.example.yml` for the standalone Runtime/PostgreSQL topology or `docker-stack.existing-postgres.example.yml` when PostgreSQL is operated separately.
- Keep PostgreSQL on a private network and persist its data independently from the Runtime container.
- Persist the Runtime key directory separately from PostgreSQL data and back up both as one recovery set.
- Runtime generates and owns the vault root and wrapping-key material stored in that protected directory.
- A missing or mismatched key/database pair fails closed.

Deployment, backup, restore, and secret inventory are documented in [PostgreSQL operations](../docs/runtime-postgresql.md).

## Worker and private-service configuration

The Worker needs the Runtime base URL and shared Runtime authentication secret. Set Runtime's `ADT_RUNTIME_WORKER_URL` to the canonical Worker origin for the scoped GitHub credential broker. Verify a signed broker request on the custom domain before retiring an alternative hostname.

Private provider/tool services are configured according to their owning connection or operator contract:

- public-provider credentials belong in the Runtime vault, not Runtime environment variables;
- MCP destinations follow the Runtime network-safety policy;
- private endpoints such as Ollama must be explicitly operator-approved;
- Codex Runner uses its own service credentials and remains a separate execution boundary;
- Security Profile services use non-secret Git configuration plus vault-backed credentials.

Do not provision Cloudflare credentials, GitHub App private keys, browser-session secrets, Codex identity, or broad Portainer/Docker credentials to Runtime.

### Conversation context settings

- `ADT_CONVERSATION_HISTORY_BYTES` sets the history budget in UTF-8 bytes. The default is 24,000 and the supported range is 1,024–60,000. Current input and history together must fit the Workflow input limit.
- `ADT_CONVERSATION_RECENT_TURNS` sets how many recent successful exchanges get first claim on the history budget. The default is three and the supported range is one to eight.
- A rolling summary carries older successful exchange content forward. Compatible entry Agents can merge new older material with their prior summary using a bounded, tool-free request. Local excerpts cover unavailable, unsupported, or uncertain summarisation.
- The exact input admitted to a Run and its context provenance are persisted for recovery and retry.

## Execution and recovery semantics

- Readiness advertises service compatibility, supported capabilities, image identity, and key identity without exposing secrets.
- Authenticated service requests are replay-protected and fail closed when malformed, stale, incompatible, or unsupported.
- Runtime advances the frozen ADT Workflow plan from durable PostgreSQL state.
- Workflow leases/fencing prevent a stale Runtime owner from committing after authority moves to another instance.
- Workflow interactions, existing approvals, and sensitive tool waits survive Runtime replacement. See [Deploy interactive Workflows](../docs/runtime-postgresql.md#deploy-interactive-workflows).
- Provider/tool work is durably journaled before later execution depends on it.
- Durable external task identities are polled/reconciled when available.
- Ambiguous synchronous provider/tool outcomes remain explicit and are not automatically replayed.
- Exact protocol fields, cryptographic construction, limits, deadlines, retry counters, and internal state transitions remain authoritative in source and tests.

## Tools and security

- Runtime owns bounded MCP discovery and invocation.
- New Workflow runs freeze the selected non-secret tool contract; normal Agent execution does not rediscover or broaden tool authority.
- Model-facing tool schemas never contain tool credentials.
- Each admitted invocation resolves only the credential and authority required for that exact call.
- ADT policy, optional human approval, and Security Profiles are evaluated before external execution.
- Security Profiles can only restrict already-authorised calls.
- Unknown external outcomes suspend Agent progression for reconciliation rather than causing another call.
- Provider/tool/security-specific limits and recovery operations are documented in [Agent tools and recovery](../docs/agent-tools-and-recovery.md).

## Diagnostics and commissioning

Commission the Runtime and each external capability separately.

1. Confirm container/process health.
2. Use **Test ADT Runtime** to verify reachability, authentication, compatibility, and required capabilities.
3. Use **Test execution path** when commissioning Workflow execution to verify the authenticated management/storage path and scoped GitHub broker without running a provider.
4. Test the relevant provider/tool/Security Profile connection separately.
5. Run a real Workflow only after the required boundaries are ready.

Passive readiness, active execution-path diagnostics, provider/tool readiness, and real execution are distinct observations.

Runtime logs use bounded structured stage/result/correlation evidence. They must not include secret values, prompts, provider payloads, arbitrary external response bodies, or raw exception text.

## Ollama/private provider endpoints

Ollama demonstrates the intended private-provider pattern:

- Runtime, not the Cloudflare Worker, reaches the configured endpoint.
- The operator explicitly allowlists acceptable endpoint origins.
- Connection configuration records only safe endpoint/authentication identity; bearer values remain in the Runtime vault.
- Model discovery and execution validate the same approved destination and do not silently redirect or fall back to a different execution path.
- Local/private network access is an intentional Runtime capability, not a general browser/Worker capability.

Exact endpoint normalisation, allowlist limits, model APIs, and provider options remain authoritative in source/tests and connection UI.

## Release identity

- Runtime exposes immutable source/image identity and a monotonic release generation used for application compatibility/freshness.
- Worker and Runtime Git commits do not need to match.
- Runtime image-input changes update the source-controlled release generation under CI policy.
- Exact release numbers and rollout ordering belong in `release.json` and trusted delivery workflows, not this document.

## Durable Agent execution contract

- Runtime performs bounded model turns, durable tool progression, security evaluation, and exact admitted tool calls through authenticated service operations.
- Model execution and tool execution have separate authority/credential boundaries.
- Runtime persists conversations, proposals, approvals, budgets, results, and uncertainty needed to resume safely.
- Missing external results never imply non-execution.
- A replacement Runtime resumes from durable PostgreSQL state rather than replaying prior external work.
- Provider-specific SDK/protocol choices remain implementation detail unless they form an externally visible product contract.
