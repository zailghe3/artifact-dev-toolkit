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
    |       - Agent, Workflow, and non-secret provider connection definitions
    |
    +--> Cloudflare D1
    |       - application sessions
    |       - permanent encrypted provider credential vault
    |       - transitional encrypted provider connection fallback state
    |       - durable Workflow run and attempt state
    |
    +--> Cloudflare KV
    |       - validated artifact catalogue cache
    |
    +--> Cloudflare Workflows
    |       - durable outer launch and recovery driver
    |
    +--> OpenAI
    |       - existing Responses execution path
    |
    +--> authenticated ADT Runtime
    |       - independently deployed stateless provider execution
    |       - LangGraph linear Workflow v2 compute
    |       - OpenAI Agents SDK / provider API
    |
    +--> independently deployed Codex Runner
            - ADT-facing controller and durable job/control state
            - isolated Codex executor and operator-provisioned workspaces
            - trusted egress proxy between executor and public Internet
```

Exact bindings, schemas, versions, limits, identifiers, protocols, retries, and deployment mechanics remain authoritative in configuration, source, tests, migrations, and component documentation.

## Major product domains

### Artifact Library

- Loads validated reusable artifacts from the configured GitHub repository.
- Supports catalogue search, detail, copy, creation, editing, variations, deletion, refresh, and diagnostics.
- Artifact Library Markdown has no lifecycle state; top-level `status` metadata is invalid.
- Validated edits and deletions are direct repository mutations.
- Repository revision checks protect against stale or ambiguous writes.

Current behaviour is defined by [`specs/000-current-application-spec.md`](specs/000-current-application-spec.md). The external repository format is defined by [`docs/external-artifact-repository-contract.md`](docs/external-artifact-repository-contract.md).

### Authentication and repository authorisation

- Users authenticate with GitHub.
- Application access is constrained to authorised users of the configured repository.
- GitHub App credentials and other secrets remain server-side.
- Protected routes authenticate and authorise before private repository or provider work.

Authentication, repository access, session persistence, and privileged mutation form security boundaries. Changes that cross them require explicit failure-path and denied-path analysis.

### Agent and Workflow definitions

- Connections identify supported execution providers without exposing credentials.
- Agents bind a connection, master prompt reference, and supported provider options.
- Workflows support compatible v1 ordered Agent steps and canonical v2 semantic block graphs; the ADT Block Registry validates the current linear Agent topology.
- Definitions are persisted through the configured GitHub-backed definition repository and use repository revisions for optimistic concurrency.
- Root-level executable definition paths are canonical while temporary legacy-layout compatibility preserves exact-path, revision-aware mutation during repository migration.

Current product behaviour is defined by [`specs/agent-workflows.md`](specs/agent-workflows.md).

### Durable Workflow execution

- Runs snapshot the definitions used for one execution.
- Cloudflare Workflows drives durable sequential execution for v1 and remains the outer launch/recovery shell for new v2 runs.
- New v2 runs freeze an ADT-owned linear execution plan. LangGraph checkpoints determine v2 execution position; D1 run and attempt rows remain audit, provider-safety, and status projections.
- A provider-neutral AgentRuntime boundary delegates one Agent step's execution to the selected provider implementation.
- D1 persists run, step, attempt, provider-task, retry, cancellation, and reconciliation state.
- Successful textual output is persisted before it can become the next step's input.
- Ambiguous external work is reconciled rather than blindly recreated.

The product invariants are in [`specs/agent-workflows.md`](specs/agent-workflows.md); migrations, source, and tests are authoritative for storage and transition mechanics.

### Provider connections

- OpenAI Responses and OpenAI Agents SDK runtimes are server-side execution providers.
- Git is authoritative for provider connection IDs defined under `connections/`; D1 remains a transitional fallback only for other IDs.
- Target Git definitions use logical `adt-vault` references while encrypted provider credential values live permanently in the D1-backed ADT vault. Source-less `WORKFLOW_PROVIDER_CONNECTION_*` references remain a transitional Cloudflare-binding contract.
- New connections use the permanent ADT vault. Authorised operators can explicitly migrate an active legacy D1 credential or source-less Cloudflare binding into it without transferring credential plaintext through the browser or Git.
- Git is authoritative for non-secret connection configuration. The logical ADT vault is authoritative for target credential values; legacy Cloudflare bindings and encrypted D1 connection rows remain source-exact compatibility state.
- Migration retains legacy bindings and D1 rows because immutable historical Workflow snapshots can still require their original source. The provider Runtime boundary is unchanged.
- Live provider readiness is distinct from saved configuration.
- External task creation, polling, retry, cancellation, and ambiguous outcomes are trust and billing boundaries.

### ADT Runtime

- ADT Runtime is an independently deployed, stateless provider-execution service.
- Explicit `openai-agents` Artifact search calls return through a bounded control-plane gateway; repository authority and credentials remain in the application.
- The Cloudflare control plane retains Workflow admission, D1 durability, provider authority, and outer recovery. The Runtime reconstructs bounded linear LangGraph compute and retains no application state or provider credential.
- A run-scoped authenticated gateway gives the Runtime only the checkpoint operations for that run; the Runtime has no D1 binding or Cloudflare credential.
- The application authenticates protocol requests and encrypts each resolved provider credential to the Runtime's operator-provisioned wrapping key.
- Protocol and capability discovery permits independent application and Runtime rollout without matching revisions or ambiguous interpretation.
- Trusted CI publishes `poulti/adt-runtime` to Docker Hub. Operator-owned deployment normally tracks `latest`; immutable Git SHA tags support provenance and rollback.
- Codex Runner remains a separate execution boundary with distinct credentials, state, and responsibilities.

Operational detail belongs in [`adt-runtime/README.md`](adt-runtime/README.md).

### Codex Runner

- Codex Runner is independently deployed from the application.
- In split Swarm mode the controller owns durable job/control state and the environment catalogue, while an independently isolated executor owns Codex authentication and private workspaces.
- Docker mounts and networks, plus the trusted egress proxy, form the split-mode execution boundary; the controller never executes model-generated commands.
- ADT references only safe Runner environment identifiers and supported public options.
- Ordinary Workflow jobs do not automatically perform Git publication actions.
- Runner reachability, protocol compatibility, authentication, environment readiness, model readiness, and job readiness are separate conditions.

Operational detail belongs in [`codex-runner/README.md`](codex-runner/README.md).

## Sources of truth and persistence

| Concern | Primary source of truth |
| --- | --- |
| Product behaviour and stable invariants | `specs/` |
| Repository-wide agent/contributor rules | `AGENTS.md` and scoped `AGENTS.md` files |
| Repeatable Codex procedures | `.agents/skills/` |
| Artifact content and Git-backed Agent, Workflow, and provider connection definitions | configured GitHub repository |
| Artifact repository layout and metadata | `docs/external-artifact-repository-contract.md` plus validation code |
| Application sessions, permanent encrypted provider credential vault, transitional provider connection fallback, and durable Workflow state | D1 schema, migrations, and source |
| Catalogue acceleration | KV cache; GitHub remains authoritative |
| Durable Workflow orchestration | v1 Cloudflare Workflow cursor; v2 Runtime LangGraph checkpoint state in control-plane D1 |
| OpenAI Agents SDK provider execution | independently deployed stateless ADT Runtime |
| Codex authentication and workspaces | isolated Codex Runner executor |
| Runner jobs, idempotency, and emergency latch | Codex Runner controller |
| Toolchain and commands | `.nvmrc`, `package.json`, repository scripts, workflows |
| Deployment configuration | committed configuration and deployment workflows |

## Important trust and state boundaries

- **Browser -> application:** treat browser input as untrusted; authorisation remains server-side.
- **Application -> GitHub:** validate exact repository targets, revisions, permissions, and mutation intent.
- **Application -> D1/KV/Workflows:** durable state transitions must remain deterministic and safe under retries, interruption, and stale observations.
- **Application -> OpenAI/provider APIs:** the existing Responses path remains direct; provider creation may be billable or side-effecting and ambiguous outcomes must not cause blind duplicate work.
- **Application -> ADT Runtime:** authenticate and integrity-bind every protocol operation, encrypt invocation credentials independently of transport TLS, and fail closed on replay, incompatibility, missing capability, or ambiguous execution outcomes.
- **Application -> Codex Runner:** expose only bounded safe configuration and diagnostics; never transfer the Runner's ChatGPT/Codex credential to ADT.
- **Runner controller -> executor:** authenticate the private control API with controller-held signing material and an executor-held verifier; never place a request-signing, ADT, or redeploy credential in the full-access executor.
- **Executor -> workspace/Internet:** filesystem and network access are controlled by container mounts, isolated overlays, and the trusted egress proxy.
- **ADT repository -> artifact repository:** application code and reusable artifact content are separate repositories and must not be mutated interchangeably without explicit task scope.

## Where to look

- Product behaviour: `specs/000-current-application-spec.md` and `specs/agent-workflows.md`.
- Repository agent rules: `AGENTS.md`; specification-writing rules: `specs/AGENTS.md`.
- Repeatable agent workflows: `.agents/skills/`.
- Human development process: `docs/development-workflow.md`.
- Feature-request hand-off: `.agents/skills/feature-request-creation/SKILL.md` and `docs/codex-create-feature-request.md`.
- Artifact storage contract: `docs/external-artifact-repository-contract.md`.
- Production configuration and recovery: `docs/github-artifact-deployment.md`.
- Dependency/toolchain policy: `docs/dependency-toolchain-maintenance.md`.
- Codex Runner operations: `codex-runner/README.md`.
- Exact internal behaviour: source, tests, schemas, migrations, configuration, and workflows.

## Keeping this map current

Update this document when a change materially alters a major component, source-of-truth boundary, persistence responsibility, trust boundary, or external-system relationship. Do not update it for ordinary internal refactors that preserve those relationships.
