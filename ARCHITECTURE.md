# Architecture

This document is a navigation map for the current system. It describes durable component responsibilities, sources of truth, persistence, and trust boundaries. Product behaviour belongs in `specs/`; exact implementation mechanics belong in source, tests, configuration, migrations, workflows, and component/operator documentation.

## System shape

```text
Authorised browser
    |
    v
Cloudflare application / Worker
    - browser session and user authorisation
    - Git-backed definition admission
    - GitHub App authority and scoped credential brokering
    - browser-facing coordination
    |
    +--> configured GitHub repositories
    |       - reusable artifacts and reviewed Advisor knowledge
    |       - non-secret Agent, Workflow, Connection, Tool, and Security Profile definitions
    |
    +--> D1
    |       - application sessions
    |
    +--> KV
    |       - disposable catalogue acceleration
    |
    +--> authenticated ADT Runtime
            - durable Workflow scheduling and execution
            - PostgreSQL operational state and encrypted credential vault
            - provider, tool, security, and private-service integrations
            - private/homelab infrastructure capabilities needed by execution
            |
            +--> Codex Runner
            |       - isolated model-directed command execution
            |       - separate trusted managed-Git authority
            |
            +--> operator-approved private/external services
                    - provider endpoints, MCP servers, Security Profile services,
                      and other purpose-specific services
```

Independently deployed services may roll at different revisions. Compatibility is established through explicit service contracts rather than matching Git commits.

## Architectural principles

- **ADT owns its domain semantics.** Workflow JSON, run snapshots, policy, authority, and recorded outcomes are product concepts; React Flow, LangGraph, provider SDKs, security SDKs, and transport libraries are replaceable implementation mechanisms.
- **Keep the public Worker thin.** Cloudflare owns browser authentication, repository admission, GitHub App authority, and browser-facing coordination. Durable execution, provider SDKs, long-running work, and private-network integrations belong outside the Worker.
- **Runtime is the durable execution and private-service plane.** ADT Runtime owns Workflow operational state, execution recovery, the encrypted provider/tool credential vault, and integrations that need private or homelab reachability.
- **Private infrastructure authority stays private.** Infrastructure credentials, local-network authority, and service-control capabilities should terminate in Runtime or another narrowly purposed trusted homelab service, not in the browser or Worker.
- **Separate identities and privileges.** User identity, GitHub App authority, provider/tool credentials, Runtime authority, Codex identity, and managed Git authority remain distinct and are transferred only when required for an exact operation.
- **Persist before depending on side effects.** Durable state records accepted external work and successful results before later work relies on them. Ambiguous external effects are reconciled rather than blindly recreated.
- **Git stores reviewed non-secret configuration; databases store operational state.** Git is recoverable and reviewable. PostgreSQL holds Runtime operational state and encrypted credentials; D1 holds browser sessions; KV is disposable acceleration.
- **Components fail closed at trust boundaries.** Missing authority, incompatible contracts, stale revisions, malformed external data, and uncertain side effects do not silently broaden capability or trigger fallback execution.
- **Independent deployment is intentional.** Worker, Runtime, Runner, and other trusted services can evolve independently behind explicit compatibility and release contracts.

## Major domains

### Artifact Library

- GitHub is authoritative for reusable Markdown artifacts.
- The application validates content before exposing it and uses revision-aware mutations so stale or ambiguous writes fail safely.
- KV may accelerate catalogue reads but is never authoritative.

Current behaviour: [Current application specification](specs/000-current-application-spec.md). Repository contract: [External artifact repository contract](docs/external-artifact-repository-contract.md).

### Authentication and repository authority

- GitHub OAuth establishes user identity; current repository authority determines whether that user may use ADT.
- Browser sessions are server-controlled and contain no GitHub or application credentials.
- The Worker retains GitHub App signing authority and mints short-lived, repository-scoped credentials for admitted operations.
- Runtime and other execution services receive scoped repository credentials only when the operation requires them.

### Git-backed executable configuration

- Agents, Workflows, provider Connections, Tools, Security Profiles, and presentation layouts use validated non-secret definitions in the configured Git repository.
- Secrets are referenced by stable logical identity and resolved only inside trusted execution boundaries.
- Workflow semantics and visual layout are stored separately; layout cannot alter execution behaviour.

Current Workflow behaviour: [Agent Workflows specification](specs/agent-workflows.md).

### Durable Workflow execution

- A launch freezes the validated definitions and authority required for that run.
- ADT Runtime owns scheduling, recovery, checkpoints, attempts, approvals, tool journals, provider-safety state, and durable run outcomes in PostgreSQL.
- LangGraph sequences the frozen ADT graph but does not define ADT's domain model.
- Provider work with a durable external identity is observed or reconciled. Synchronous or otherwise ambiguous side effects are not automatically repeated.

### Provider connections

- Connections define non-secret provider identity, safe configuration, authentication family, model requirements, and supported capabilities.
- Runtime resolves provider credentials from the encrypted repository-scoped vault for the exact operation.
- Provider discovery, diagnostics, and execution expose only bounded safe results to the Worker.
- Provider-specific capabilities may differ; the provider registry and tests are authoritative for the exact current matrix.

### Tools and Security Profiles

- Tools are separate from model-provider Connections. MCP is the configurable remote-tool integration currently supported.
- Agent grants define maximum tool authority. Trusted policy, optional human approval, and Security Profiles can narrow that authority but cannot expand it.
- Runtime owns tool discovery/execution and evaluates exact admitted calls. Credentials never enter model-visible schemas or run definitions.
- Unknown external tool outcomes block progression for reconciliation rather than being retried automatically.
- Security Profiles contain non-secret trust configuration in Git; their credentials remain in the Runtime vault.

Operational policy and recovery: [Agent tools and recovery](docs/agent-tools-and-recovery.md).

### Advisor

- Advisor is an ordinary constrained Workflow entry point, not a separate execution engine or privileged identity.
- It may receive explicitly granted read capabilities through the same durable Agent/tool policy model.
- Model execution remains read-only. Reviewed knowledge publication is a separate authenticated human Git mutation.
- Approved Advisor knowledge is authoritative in Git; Runtime stores operational settings, proposals, and publication state.

Setup and operating guidance: [Advisor setup](docs/advisor-setup.md).

### ADT Runtime

- Runtime is independently deployed and owns durable Workflow execution plus its supporting PostgreSQL state and key material.
- It hosts execution-heavy provider/tool/security integrations and is the preferred boundary for capabilities that require private-network or homelab access.
- Runtime may control narrowly scoped private infrastructure operations needed for the services it owns, without transferring those infrastructure credentials to Cloudflare or the browser.
- The Worker remains the authority for browser users and broad GitHub App signing; Runtime obtains scoped repository authority through the Worker broker.

Operator contract: [ADT Runtime](adt-runtime/README.md). PostgreSQL operations: [Runtime PostgreSQL](docs/runtime-postgresql.md).

### Codex Runner

- Codex Runner is a separate trust boundary for model-directed command execution.
- In the reference split design, Controller owns admission/control, Executor owns Codex identity and command execution, and Repository Manager alone owns trusted managed-Git state and authenticated Git transport.
- Executor never receives GitHub installation credentials or infrastructure authority.
- Managed publication is explicit and reconciles uncertain mutations rather than replaying them.

Operator/security contract: [Codex Runner](codex-runner/README.md).

## Sources of truth and persistence

| Concern | Primary source of truth |
| --- | --- |
| Product behaviour and stable invariants | `specs/` |
| Repository-wide contributor/Codex rules | `AGENTS.md` and scoped `AGENTS.md` files |
| Repeatable Codex procedures | `.agents/skills/` |
| Artifacts, reviewed knowledge, and non-secret executable configuration | configured GitHub repository |
| Artifact repository layout and metadata | `docs/external-artifact-repository-contract.md` plus validation code |
| Browser sessions | D1 |
| Durable Workflow, approval, tool, Advisor operational state and encrypted provider/tool credentials | Runtime PostgreSQL plus Runtime key material |
| Catalogue acceleration | KV; Git remains authoritative |
| Workflow sequencing | ADT Runtime using the frozen ADT execution plan and LangGraph |
| Codex identity and model-directed command execution | Codex Runner Executor |
| Managed Git authority | Codex Runner Repository Manager |
| Runner job/idempotency control | Codex Runner Controller |
| Exact toolchain, deployment, release, and protocol mechanics | source, configuration, migrations, scripts, tests, and workflows |

## Recovery characteristics

- Git restores non-secret reviewed configuration and published knowledge.
- Runtime recovery requires PostgreSQL together with its matching protected key material.
- KV catalogue state may be discarded and rebuilt from Git.
- D1 session state is independent from Runtime operational state.
- Codex Runner has separate operator-managed recovery requirements for controller jobs, Codex identity/state, SQLite state, workspaces, and managed repository authority.

## Trust boundaries

- **Browser -> Worker:** all browser input is untrusted; authentication and authorisation remain server-side.
- **Worker -> GitHub:** exact repository target, revision, capability, and mutation intent are validated before short-lived authority is used or brokered.
- **Worker -> Runtime:** requests are authenticated, bounded, compatibility-checked, and scoped to the current user/repository operation.
- **Runtime -> PostgreSQL:** durable transitions are fenced so stale workers cannot commit after losing authority.
- **Runtime -> providers/tools/private services:** destinations and credentials are resolved through explicit configuration and policy; raw external failures do not become trusted application data.
- **Runtime -> Worker GitHub broker:** Runtime requests only the repository capability required for an admitted operation; broad GitHub App signing authority stays in the Worker.
- **Runtime -> Codex Runner:** Runtime can request bounded Runner operations but never receives the Runner's Codex identity.
- **Runner Controller -> Executor/Repository Manager:** Controller signs internal authority; execution and Git roles receive verification authority only.
- **Executor -> Repository Manager:** model-directed execution cannot manufacture trusted Git authority.

## Delivery and publication

- One fail-closed impact policy selects relevant verification and production operations.
- Pull-request workflows verify with read-only repository authority; production mutation occurs only from trusted merged source.
- Production images are rebuilt and smoke-tested from immutable merged source rather than promoted from PR artifacts.
- Worker, Runtime, and Runner publication/deployment effects are independently selected and freshness-aware.
- Cross-component ordering is introduced only where components share an explicit production compatibility contract.

Exact path classification, checks, release identifiers, workflow permissions, and recovery mechanics belong in CI configuration and operational documentation.

## Where to look

- Product behaviour: `specs/000-current-application-spec.md`
- Workflow/Agent behaviour: `specs/agent-workflows.md`
- External Git repository contract: `docs/external-artifact-repository-contract.md`
- Runtime operations: `adt-runtime/README.md`, `docs/runtime-postgresql.md`
- Runner operations/security: `codex-runner/README.md`
- Tool approval/recovery: `docs/agent-tools-and-recovery.md`
- Advisor setup: `docs/advisor-setup.md`
- Development/delivery process: `docs/development-workflow.md`

Keep this map focused on durable boundaries. When an implementation detail becomes independently replaceable, prefer linking to its owning component/source rather than adding another mechanism-specific paragraph here.
