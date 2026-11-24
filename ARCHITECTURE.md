# Architecture

This document is a navigation map for the current system. It describes major domains, sources of truth, persistence boundaries, trust boundaries, and where deeper contracts live. It is not a product specification or an implementation design.

## System shape

```text
Authorised browser
    |
    v
Artifact Toolkit application
Next.js -> OpenNext -> Cloudflare Worker
    |
    +--> GitHub App / configured artifact repository
    |       - reusable artifacts
    |       - Agent, Workflow, layout, and non-secret connection definitions
    |
    +--> Cloudflare D1
    |       - application sessions
    |
    +--> Cloudflare KV
    |       - disposable validated catalogue cache
    |
    +--> authenticated ADT Runtime
    |       - leased Workflow scheduling, recovery and LangGraph sequencing
    |       - PostgreSQL run, checkpoint, approval, tool and operational state
    |       - encrypted provider credential vault and Work IQ OAuth exchanges
    |       - provider and bounded MCP client execution
    |       - scoped GitHub credentials brokered by the Worker
    |       - fixed Runtime and Runner redeploy webhooks
    |
    +--> independently published Adrian backend
    |       - vendored, provenance-verified upstream backend image
    |       - independently operated runtime data, models, and configuration
    |
    +--> independently deployed Codex Runner
            - Controller: ADT-facing admission and durable job/control state
            - Executor: isolated Codex execution and Codex identity
            - Repository Manager: trusted Git authority for managed repositories
            - separate executor and repository egress boundaries
```

Exact bindings, schemas, versions, limits, identifiers, protocols, retries, and deployment mechanics remain authoritative in configuration, source, tests, migrations, workflows, and component documentation.

## Architectural principles

- ADT owns the durable domain model, policy, authorisation, and recorded outcomes; framework-specific objects are replaceable implementation roles rather than the product model.
- React Flow presents Workflow graphs; canonical Workflow v2 JSON defines semantics; LangGraph performs sequencing; provider runtimes execute AI work.
- Git stores recoverable non-secret configuration. The encrypted ADT vault stores provider credential values. D1 stores web sessions. Runtime owns operational state and the credential vault in PostgreSQL. KV is disposable acceleration.
- The Cloudflare Worker is ADT's control plane for user authorisation, Git authority, Workflow admission and scoped GitHub credentials.
- Browsers and execution services receive only the authority needed for their role; broad GitHub, Cloudflare, vault, or infrastructure credentials remain in the control plane or the exact trusted component that needs them.
- Keep the Cloudflare Worker lean. Execution-heavy provider SDKs and orchestration libraries belong in ADT Runtime unless they genuinely require control-plane authority.
- ADT Runtime is the extensible AI execution plane; Codex Runner remains a separate trust boundary for model-directed command execution.
- Tool integrations are distinct from provider Connections. Runtime runs built-in and remote tools through a shared policy gate. GitHub access uses the Worker credential broker.

## Major product domains

### Artifact Library

- Loads validated reusable artifacts from the configured GitHub repository.
- Supports catalogue search, detail, copy, creation, editing, variations, deletion, refresh, and diagnostics.
- Artifact Library Markdown has no lifecycle state; top-level `status` metadata is invalid.
- Validated edits and deletions are direct repository mutations protected by repository revision checks.

Current behaviour is defined by [`specs/000-current-application-spec.md`](specs/000-current-application-spec.md). The external repository format is defined by [`docs/external-artifact-repository-contract.md`](docs/external-artifact-repository-contract.md).

### Authentication and repository authorisation

- GitHub OAuth establishes user identity.
- Application access additionally requires current authority to the configured artifact repository and may be further restricted by operator policy.
- Browser sessions are server-controlled and do not expose GitHub or application credentials.
- Repository authority is revalidated during a session rather than trusted indefinitely from login time.
- Privileged repository operations use the server-side GitHub App with short-lived, repository-scoped authority appropriate to the operation.
- User identity/authorisation and application repository credentials are deliberately separate boundaries.

Authentication, repository access, session persistence, and privileged mutation form security boundaries. Changes that cross them require explicit failure-path and denied-path analysis.

### Agent and Workflow definitions

- Connections identify supported execution providers without exposing credentials.
- Agents bind a connection, prompt, and supported provider options.
- Workflows use canonical v2 semantic block graphs validated by the ADT Block Registry.
- Definitions are persisted through the configured GitHub-backed definition repository and use repository revisions for optimistic concurrency.
- Executable definitions are discovered and mutated only at root-level `agents/` and `workflows/` paths.

Current product behaviour is defined by [`specs/agent-workflows.md`](specs/agent-workflows.md).

### Durable Workflow execution

- Runs snapshot the definitions used for one execution, including resolved reusable Workflow composition.
- Runtime schedules and recovers runs with PostgreSQL leases and advances LangGraph from durable checkpoints.
- New runs freeze an ADT-owned versioned graph execution plan.
- A provider-neutral AgentRuntime boundary delegates model work to the selected provider implementation. Tool-enabled OpenAI, Anthropic and Ollama Agents progress through an PostgreSQL-backed conversation and tool journal.
- PostgreSQL persists durable run, attempt, approval, retry, cancellation, provider-safety, and reconciliation state.
- Successful output is persisted before later work depends on it.
- Ambiguous external work is reconciled rather than blindly recreated.

The product invariants are in [`specs/agent-workflows.md`](specs/agent-workflows.md); migrations, source, and tests are authoritative for storage and transition mechanics.

### Provider connections

- OpenAI Responses, OpenAI Agents SDK, Anthropic Messages, Microsoft Work IQ REST, and Ollama Chat are supported server-side execution providers.
- Git-managed provider connection types centrally define their safe configuration, authentication family, model policy, Agent option family, execution path, and capabilities; unsupported types and authentication lifecycles fail closed.
- Git definitions under `connections/` are authoritative for validated non-secret connection configuration; only explicitly execution-safe provider fields may enter run snapshots.
- Provider credential values live in the permanent encrypted ADT vault and are never stored in Agent or Workflow definitions.
- The Worker handles the Work IQ browser redirect. Runtime owns the OAuth exchange, encrypted client secrets and refresh tokens, and call-scoped access tokens.
- OpenAI Agents, Anthropic Messages, Work IQ, and Ollama Workflow Agents execute through ADT Runtime. Runtime also coordinates asynchronous OpenAI Responses work and delegates Codex jobs to Codex Runner.
- The Worker serves OpenAI and Anthropic model commissioning, using repository-scoped credential access. Ollama model commissioning runs through authenticated ADT Runtime because its endpoint may exist only on the Runtime Docker/LAN network.
- Ollama follows Cloudflare → ADT Runtime → exact operator-approved endpoint. Its safe base URL and explicit authentication mode are immutable connection identity and frozen with each run. Runtime rejects endpoints outside its operator allowlist before network access and never follows redirects.
- Unauthenticated Ollama connections have no vault identity. Runtime resolves optional bearer credentials from its vault for the exact invocation. Ollama has no direct compatibility fallback.
- Historical provider rows or retired credential sources may remain physically present but are not current execution inputs.
- Live provider readiness is distinct from saved configuration.
- Provider creation, polling, retry, cancellation, and ambiguous outcomes are trust and billing boundaries.

### Tools

- Tools is the Workflow-area domain for Agent tool integrations; MCP is the first configurable external integration type and remains separate from provider Connections.
- Git definitions under `tools/` hold non-secret MCP configuration, discovered catalogues and policy declarations. Protected PostgreSQL attestations independently authorize trusted policy against exact repository, tool, target and credential identities; Git write access alone never grants policy-administrator authority. Bearer values remain in the encrypted ADT vault.
- Agent definitions grant an MCP server stable ID and explicitly selected remote tool names. New Workflow runs freeze the selected non-secret execution contract, so later catalogue or server edits affect future runs only.
- Runtime admits only credential-binding generations tied to the frozen endpoint and repository, and resolves credentials for the exact invocation. Credentials never enter run snapshots.
- ADT Runtime alone owns the MCP client. It exposes authorised tools through collision-safe aliases derived from server ID and remote name, applies the shared tool security gate and call budget, and calls the unchanged remote name.
- Normal Agent execution never discovers or refreshes an MCP catalogue. Agent-tool eligibility follows provider capability policy.

- The Worker verifies protected policy through Runtime at run admission. Runtime revalidates policy at execution. Explicitly delegated tool approvers remain distinct from repository users, policy administrators and reconciliation operators.
- Runtime journals complete tool proposals before policy, approval or execution. Models receive schemas without tool credentials. Each Runtime tool request contains one admitted invocation and scoped credentials.
- Unknown external outcomes suspend Agent progression for operator reconciliation; timers never retry admitted uncertain calls. See [Agent tools and recovery](docs/agent-tools-and-recovery.md) for policies, continuation and cutover.

### Advisor

- Advisor launches an explicitly configured ordinary Workflow through the shared durable admission path; it is not a separate execution engine or privileged identity.
- Runtime persists repository-scoped Advisor settings and frozen run contexts in PostgreSQL. Effective Agent and provider overrides use the existing run snapshots without rewriting Git definitions.
- Native ADT metadata tools reuse the provider-neutral Agent tool journal, admission and shared security gate. Runtime checks exact frozen grants, active attempt authority and current repository identity before scoped Git or PostgreSQL reads.
- Existing metadata projections exclude sensitive content. Independently granted deeper observability tools require exact-call human approval, frozen scope and current authority; raw errors and unsafe external payloads remain omitted.
- Approved Advisor knowledge lives only in the configured Git repository under `advisor/knowledge/`. PostgreSQL stores account/repository-scoped proposals, expiring session-bound review consent and publication state, never an authoritative accepted-knowledge index.
- The trusted browser/application boundary alone can publish reviewed knowledge through short-lived GitHub App authority and optimistic concurrency. Consent is consumed once per mutation; uncertain writes are never replayed. Model tools and ADT Runtime cannot access this publication authority.
- Advisor's backend allowlist includes the explicitly granted native readers and excludes external tools, Codex and publication even through composed Workflows.

### Security Profiles

- Security Profiles are a first-class domain, separate from Connections, Tools, Agents, and Workflows.
- Git definitions under `security-profiles/` contain only validated non-secret Adrian configuration. Adrian API keys belong in the encrypted, repository-scoped vault and never enter Git or run snapshots.
- Agents may optionally reference a Security Profile only when their provider connection advertises Runtime security support. Absence preserves unsecured execution behavior.
- Adrian is an additional restriction after ADT authorization, frozen tool authority, and the global tool-call budget; it cannot grant tools or expand an MCP contract.
- New runs freeze each secured Agent's profile identity, endpoint, decision timeout, and repository-scoped credential generation. Execution resolves only that generation, so same-endpoint key rotation remains live while endpoint changes and deletion revoke historical authority.
- Tool-enabled OpenAI, Anthropic and supported Ollama execution uses the same Runtime Adrian exact-call evaluation. The Adrian SDK remains Runtime-only.
- Runtime security decisions are `allow`, `deny`, `timeout`, or `unavailable`. Only positive, exact-call allow evidence permits external tool execution; every other or ambiguous state fails closed.
- Adrian's process-global lifecycle requires one exclusive security evaluation per Runtime process. Contending evaluations fail closed without queueing. No lease survives a human wait.
- Adrian policy and remit remain managed by Adrian. Human Review and HITL are not part of the automated V1 enforcement contract.

### ADT Runtime

- ADT Runtime owns Workflow scheduling, recovery, approvals, provider and tool credentials, tool policies, Advisor settings and Codex registrations in PostgreSQL.
- The Worker authenticates users, freezes validated Git definitions, and brokers short-lived credentials scoped to the repository and operation.
- Runtime resolves credentials for the exact provider or tool invocation. The Worker retains broad GitHub App authority.
- Runtime and the Worker authenticate protocol operations and reject incompatible capabilities.
- Execution-heavy AI/provider libraries that do not need broad control-plane authority belong here.
- Runtime may hold only four operator-provisioned, narrowly scoped Portainer webhook URLs for Runtime and split Runner redeployment. Portainer remains private; these URLs never enter Cloudflare or browser state, and Runtime receives no Portainer API credential or Docker socket.

Operational detail belongs in [`adt-runtime/README.md`](adt-runtime/README.md).

### Codex Runner

- Codex Runner is independently deployed from the application; split mode is the reference security architecture and integrated mode remains a compatibility deployment.
- The **Controller** owns the ADT-facing API, admission, durable job/idempotency state, emergency control, and internal request-signing authority. It does not execute model-generated commands.
- The **Executor** owns Codex authentication and model-directed execution inside a constrained container. It receives no GitHub credential, controller signing authority, durable controller state, or infrastructure restart credential.
- The **Repository Manager** owns managed Git state and authenticated Git transport. It never executes model-generated commands and is the only Runner role trusted to publish managed repository changes.
- Controller-signed internal requests are verified by Executor and Repository Manager; verifier material cannot mint controller requests.
- In split mode the executor container is the Codex execution security boundary. Admitted `workspace-write` execution may use Codex full access inside that constrained container and does not depend on native Codex sandboxing.
- Executor and Repository Manager use separate network/egress paths. Executor egress is restricted to required model/auth services; Repository Manager's network path blocks non-public destinations while trusted code constrains managed Git targets to configured GitHub repositories.
- Ordinary Workflow jobs do not automatically perform Git publication actions.

Operational detail belongs in [`codex-runner/README.md`](codex-runner/README.md).

## Sources of truth and persistence

| Concern | Primary source of truth |
| --- | --- |
| Product behaviour and stable invariants | `specs/` |
| Repository-wide agent/contributor rules | `AGENTS.md` and scoped `AGENTS.md` files |
| Repeatable Codex procedures | `.agents/skills/` |
| Artifact content and Git-backed Agent, Workflow, layout, provider connection, and Security Profile definitions | configured GitHub repository |
| Approved Advisor knowledge | configured GitHub repository (`advisor/knowledge/`) |
| Artifact repository layout and metadata | `docs/external-artifact-repository-contract.md` plus validation code |
| Application sessions | D1 schema and auth migrations |
| Encrypted vault, Advisor proposals and durable Workflow state | Runtime PostgreSQL schema and migrations |
| Advisor settings and Codex environment registrations | [Runtime PostgreSQL](docs/runtime-postgresql.md) |
| Catalogue acceleration | KV cache; GitHub remains authoritative |
| Durable Workflow orchestration | Runtime leases, LangGraph and PostgreSQL checkpoints |
| Ordinary AI provider execution (OpenAI Agents, Anthropic Messages, Work IQ, Ollama) | independently deployed ADT Runtime |
| Codex authentication and model-directed command execution | Codex Runner Executor |
| Managed Git authority | Codex Runner Repository Manager |
| Runner jobs, idempotency, and emergency latch | Codex Runner Controller |
| Toolchain and commands | `.nvmrc`, `package.json`, repository scripts, workflows |
| Deployment and publication mechanics | committed configuration, classifier policy, and GitHub Actions workflows |

## Recovery characteristics

- Git is the durable recovery source for non-secret ADT configuration.
- PostgreSQL contains durable history and encrypted vault state. Recovery requires a database backup and matching vault root.
- Runtime pins the vault root fingerprint in PostgreSQL and keeps the root in a protected key directory.
- KV catalogue state may be discarded and rebuilt from Git.
- Runtime instances share PostgreSQL and a protected root-key export. Back up the database and its matching key separately.
- Codex Runner owns separate operator-managed durable state for Controller jobs, Codex identity/home state, local SQLite state, and managed repository authority where configured.

## Important trust and state boundaries

- **Browser -> application:** treat browser input as untrusted; authentication and authorisation remain server-side.
- **Application -> GitHub:** validate exact repository targets, revisions, permissions, and mutation intent; use short-lived operation-scoped authority.
- **Runtime -> PostgreSQL:** fenced state transitions remain safe under retries, interruption and stale observations.
- **Application -> provider APIs:** provider work may be billable or side-effecting; ambiguous outcomes must not cause blind duplicate work.
- **Application -> ADT Runtime:** authenticate narrowly scoped operations, keep GitHub App credentials in the Worker and fail closed on replay, incompatibility or missing authority. Authorised maintenance sends only a fixed Runtime/Runner target; Runtime alone dispatches its private scoped webhooks.
- **Application -> Codex Runner:** expose bounded configuration and diagnostics; never transfer the Runner's Codex credential to ADT.
- **Runner Controller -> Executor/Repository Manager:** Controller alone holds internal signing authority; execution and Git roles receive verifier material only.
- **Executor -> workspace/Internet:** model-directed access is constrained by the container, mounts, isolated overlays, and restricted executor egress.
- **Repository Manager -> GitHub:** trusted code owns repository identity and Git authority; credentials are bounded to the operation and never enter the Executor.
- **ADT repository -> artifact/code repositories:** application source, reusable artifact content, and managed code repositories are distinct authorities unless explicitly configured otherwise.

## Delivery and publication boundary

- One fail-closed change-impact policy determines which verification and production operations a change requires.
- Pull-request workflows verify with read-only repository authority; production mutation occurs only from trusted `main` workflows or an explicit operator recovery path.
- Production Worker and container artifacts are built from immutable merged source; PR-built artifacts are verification evidence and are not promoted.
- Cloudflare Worker deployment, D1 migrations, ADT Runtime publication, Codex Runner publication, and Adrian backend publication are independently gated operations.
- Required migrations, Worker deployment, and production smoke gate mixed Cloudflare/Runtime publication. Successful eligible Cloudflare deployments also reconcile the current Runtime release after an earlier blocked publication; Runtime-only releases retain independent publication.
- Unknown or newly introduced paths fail closed until the impact policy classifies them.
- Publication freshness is component-aware: an older immutable target may proceed only when later commits do not supersede the same production component.

Exact path classification, job selection, permissions, freshness rules, release barriers, and recovery mechanics remain authoritative in `scripts/` and `.github/workflows/`.

## Where to look

- Product behaviour: `specs/000-current-application-spec.md` and `specs/agent-workflows.md`.
- Repository agent rules: `AGENTS.md`; specification-writing rules: `specs/AGENTS.md`.
- Repeatable agent workflows: `.agents/skills/`.
- Human development process: `docs/development-workflow.md`.
- Feature-request hand-off: `.agents/skills/feature-request-creation/SKILL.md` and `docs/codex-create-feature-request.md`.
- Artifact storage contract: `docs/external-artifact-repository-contract.md`.
- Production configuration and recovery: `docs/github-artifact-deployment.md`.
- Dependency/toolchain policy: `docs/dependency-toolchain-maintenance.md`.
- ADT Runtime operations: `adt-runtime/README.md`.
- Codex Runner operations: `codex-runner/README.md`.
- Adrian backend vendoring and publication: `adrian/README.md`.
- Exact internal behaviour: source, tests, schemas, migrations, configuration, scripts, and workflows.

## Keeping this map current

Update this document when a change materially alters a major component, source-of-truth boundary, persistence responsibility, trust boundary, delivery boundary, or external-system relationship. Do not update it for ordinary internal refactors that preserve those relationships.
