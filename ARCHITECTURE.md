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
    |       - encrypted provider credential vault
    |       - durable Workflow run and attempt state
    |
    +--> Cloudflare KV
    |       - disposable validated catalogue cache
    |
    +--> Cloudflare Workflows
    |       - durable outer launch, recovery, and human-event lifecycle
    |
    +--> OpenAI
    |       - direct Responses execution path
    |
    +--> authenticated ADT Runtime
    |       - LangGraph Workflow sequencing
    |       - execution-heavy provider SDKs
    |       - no durable ADT state or broad control-plane authority
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
- Git stores recoverable non-secret configuration. The encrypted ADT vault stores provider credential values. D1 stores durable application and execution state. KV is disposable acceleration.
- The Cloudflare Worker is ADT's trust and durable-control plane, including user authorisation, Git authority, credential resolution, Workflow admission, and narrow privileged gateways.
- Browsers and execution services receive only the authority needed for their role; broad GitHub, Cloudflare, vault, or infrastructure credentials remain in the control plane or the exact trusted component that needs them.
- Keep the Cloudflare Worker lean. Execution-heavy provider SDKs and orchestration libraries belong in ADT Runtime unless they genuinely require control-plane authority.
- ADT Runtime is the extensible AI execution plane; Codex Runner remains a separate trust boundary for model-directed command execution.

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
- Cloudflare Workflows owns the durable outer lifecycle; LangGraph sequencing runs in ADT Runtime; checkpoints are persisted behind the control plane in D1.
- New runs freeze an ADT-owned versioned graph execution plan.
- A provider-neutral AgentRuntime boundary delegates individual Agent work to the selected provider implementation.
- D1 persists durable run, attempt, approval, retry, cancellation, provider-safety, and reconciliation state.
- Successful output is persisted before later work depends on it.
- Ambiguous external work is reconciled rather than blindly recreated.

The product invariants are in [`specs/agent-workflows.md`](specs/agent-workflows.md); migrations, source, and tests are authoritative for storage and transition mechanics.

### Provider connections

- OpenAI Responses and OpenAI Agents SDK are supported server-side execution providers.
- Git-managed provider connection types centrally define their safe configuration, authentication kind, model policy, Agent option family, execution path, and capabilities; unsupported types fail closed.
- Git definitions under `connections/` are authoritative for current non-secret connection configuration.
- Provider credential values live in the permanent encrypted ADT vault and are never stored in Agent or Workflow definitions.
- Historical provider rows or retired credential sources may remain physically present but are not current execution inputs.
- Live provider readiness is distinct from saved configuration.
- Provider creation, polling, retry, cancellation, and ambiguous outcomes are trust and billing boundaries.

### ADT Runtime

- ADT Runtime is an independently deployed, replaceable compute and provider-execution service with no durable ADT state or persisted provider credentials.
- LangGraph computes bounded Workflow progression, but durable checkpoints and executable-node admission remain behind narrowly scoped Worker gateways.
- The Worker retains Workflow admission, durable state, credential authority, outer recovery, and repository/tool authority.
- Provider credentials are resolved in the control plane and supplied only for the exact invocation that needs them.
- Runtime and application revisions may roll independently through explicit protocol and capability compatibility.
- Execution-heavy AI/provider libraries that do not need broad control-plane authority belong here.

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
| Artifact content and Git-backed Agent, Workflow, layout, and provider connection definitions | configured GitHub repository |
| Artifact repository layout and metadata | `docs/external-artifact-repository-contract.md` plus validation code |
| Application sessions, encrypted provider credential vault, and durable Workflow state | D1 schema, migrations, and source |
| Catalogue acceleration | KV cache; GitHub remains authoritative |
| Durable Workflow orchestration | Cloudflare Workflows outer lifecycle; LangGraph sequencing in ADT Runtime; checkpoints persisted behind the control plane in D1 |
| OpenAI Agents SDK provider execution | independently deployed ADT Runtime |
| Codex authentication and model-directed command execution | Codex Runner Executor |
| Managed Git authority | Codex Runner Repository Manager |
| Runner jobs, idempotency, and emergency latch | Codex Runner Controller |
| Toolchain and commands | `.nvmrc`, `package.json`, repository scripts, workflows |
| Deployment and publication mechanics | committed configuration, classifier policy, and GitHub Actions workflows |

## Recovery characteristics

- Git is the durable recovery source for non-secret ADT configuration.
- D1 contains durable history and encrypted vault state; losing it may lose history and require credentials to be restored or re-entered.
- The vault encryption key remains outside D1; loss of that key makes vault ciphertext unusable without exposing plaintext.
- KV catalogue state may be discarded and rebuilt from Git.
- ADT Runtime is replaceable without local durable state.
- Codex Runner owns separate operator-managed durable state for Controller jobs, Codex identity/home state, local SQLite state, and managed repository authority where configured.

## Important trust and state boundaries

- **Browser -> application:** treat browser input as untrusted; authentication and authorisation remain server-side.
- **Application -> GitHub:** validate exact repository targets, revisions, permissions, and mutation intent; use short-lived operation-scoped authority.
- **Application -> D1/KV/Workflows:** durable transitions must remain deterministic and safe under retries, interruption, and stale observations.
- **Application -> provider APIs:** provider work may be billable or side-effecting; ambiguous outcomes must not cause blind duplicate work.
- **Application -> ADT Runtime:** authenticate protocol operations, keep durable state and broad credentials out of Runtime, and fail closed on replay, incompatibility, missing capability, or ambiguous provider outcomes.
- **Application -> Codex Runner:** expose bounded configuration and diagnostics; never transfer the Runner's Codex credential to ADT.
- **Runner Controller -> Executor/Repository Manager:** Controller alone holds internal signing authority; execution and Git roles receive verifier material only.
- **Executor -> workspace/Internet:** model-directed access is constrained by the container, mounts, isolated overlays, and restricted executor egress.
- **Repository Manager -> GitHub:** trusted code owns repository identity and Git authority; credentials are bounded to the operation and never enter the Executor.
- **ADT repository -> artifact/code repositories:** application source, reusable artifact content, and managed code repositories are distinct authorities unless explicitly configured otherwise.

## Delivery and publication boundary

- One fail-closed change-impact policy determines which verification and production operations a change requires.
- Pull-request workflows verify with read-only repository authority; production mutation occurs only from trusted `main` workflows or an explicit operator recovery path.
- Production Worker and container artifacts are built from immutable merged source; PR-built artifacts are verification evidence and are not promoted.
- Cloudflare Worker deployment, D1 migrations, ADT Runtime publication, and Codex Runner publication are independently gated operations.
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
- Exact internal behaviour: source, tests, schemas, migrations, configuration, scripts, and workflows.

## Keeping this map current

Update this document when a change materially alters a major component, source-of-truth boundary, persistence responsibility, trust boundary, delivery boundary, or external-system relationship. Do not update it for ordinary internal refactors that preserve those relationships.
