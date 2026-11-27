# Artifact Toolkit — Agent Workflows Specification

**Document status:** Baseline specification of implemented Agent Workflow behaviour  
**Scope:** Current behaviour only; not a roadmap or implementation design

## 1. Purpose

- Agent Workflows execute bounded graphs of configured Agents and deterministic control blocks.
- ADT owns Workflow semantics, durable execution policy, authority, history, retry/cancellation behaviour, and recorded outcomes.
- Agents perform reasoning and text generation through configured provider Connections.
- Tools, Security Profiles, and Codex execution are distinct authority domains layered onto Agent execution.
- Implementation libraries, storage schemas, wire protocols, exact limits, and deployment mechanics are outside this specification.

## 2. Core concepts

- A **Connection** identifies one supported execution provider and its safe non-secret configuration without exposing private credentials.
- An **Agent** selects a Connection, prompt, supported provider options, and optional tool/Security Profile configuration.
- A **Tool grant** defines maximum callable tool authority for an Agent.
- A **Security Profile** can further restrict eligible tool execution; it cannot grant tools or broaden ADT authority.
- A **Workflow** is an ADT-owned semantic graph of versioned blocks and edges.
- A **Workflow layout** is presentation state only and never changes execution semantics.
- A **Conversation** connects a fixed Agent or Workflow target to ordered messages and their Runs.
- A **Run** freezes the validated definitions and authority needed for one execution.
- An **Attempt** records one Agent activation attempt.
- External task or publication identities may be retained where needed to observe or reconcile accepted work safely.

## 3. Workflow definitions

- Current Workflow definitions use the canonical v2 semantic graph.
- Supported semantic behaviour includes Agent execution, deterministic Conditions, parallel fan-out/Join, human Approval, reusable Workflow composition, bounded cycles, Knowledge Proposals, and explicit managed GitHub publication.
- Unsupported block contracts, invalid topology, unresolved references, or exceeded execution bounds fail closed before execution.
- Reusable Workflows expand into the parent run rather than creating independent child runs.
- Composition is bounded and rejects missing, cyclic, unexposed, or unsupported dependencies.
- Semantic edges determine execution independently of node ordering and visual placement.
- Layout positions, viewport state, and edge waypoints never alter execution order, topology, handoff, authority, limits, or results.
- Semantic and layout mutations are persisted separately and use revision-aware Git writes.
- Authoring/import helpers may transfer safe Workflow semantics and presentation data, but never persist automatically or bypass normal validation.
- Imported drafts cannot overwrite an existing Workflow without going through normal identity and persistence rules.
- Clipboard/authoring formats are documented in [Workflow text authoring](../docs/workflow-text-authoring.md).

## 4. Run snapshots, handoff, and context

- Launch freezes the complete current Workflow, reusable composition, relevant Agents, connection snapshots, resolved prompt content, and other execution authority needed by the run.
- Later edits affect new runs only.
- A Conversation can target a single Agent through a generated one-block Workflow. Each submitted turn freezes the exact input assembled from the current message and its authorised history.
- Context can include every visible section of a successful response. Requested exact exchanges preserve the text of their sections. Older exchanges can contribute to a continuing, bounded summary with recorded provenance.
- Conversation history and summaries are untrusted reference data. They cannot expand tool grants, repository permissions, or approval authority.
- Conversation context enters at Workflow entry. Existing Workflow handoffs and explicitly configured Codex continuation retain their own semantics.
- Snapshots retain safe credential references and validated non-secret configuration, never resolved secret values.
- The first Agent on a path receives the Workflow input; later Agents receive the successful textual output selected by graph execution.
- Handoff text is not implicitly summarised, ranked, rewritten, or interpreted by the framework.
- Agent blocks may publish selected successful text for explicit later reference context without creating a new graph dependency.
- Context selection is frozen with the run and can only use already available successful outputs from the current run/path.
- Reusable Workflow outputs remain part of the parent run and expose their successful terminal text to the parent graph.
- Codex conversation continuation is distinct from Workflow context selection: continuation reuses an eligible prior Codex conversation while graph handoff remains the new turn input.
- Continuation relationships are explicit, frozen, structurally constrained, and never fall back to silently starting a replacement conversation.
- Managed Codex continuation additionally requires the previously validated managed repository/publication association.

## 5. Durable execution

- ADT Runtime owns the durable Workflow lifecycle and operational state.
- Runtime persists run state, attempts, approvals, checkpoints, provider/tool journals, reconciliation state, settings, and encrypted provider/tool credentials in PostgreSQL.
- A replacement Runtime instance resumes from the same durable state and protected key material rather than relying on process memory.
- LangGraph sequences the frozen ADT execution plan; it does not define ADT's semantic model or authority policy.
- Successful output is persisted before downstream work can depend on it.
- Re-observing already successful work reuses the recorded result rather than repeating it.
- External work with a durable task identity is observed or reconciled instead of recreated.
- Branch failure prevents unsafe new admission and accounts for already-admitted sibling work before a truthful terminal result.
- Terminal runs remain terminal when observed again.
- Runtime, Worker, and other services may roll independently when their explicit compatibility contract permits it.

### Human Approval blocks

- Approval pauses the exact frozen block activation and exposes immutable review text to an authorised user.
- An approval decision resumes that activation only; stale decisions cannot approve a later visit.
- Definition changes while paused do not rewrite the frozen run.
- Human waiting does not consume active execution duration.
- Cancellation remains available while waiting and prevents downstream admission when it wins durably.

## 6. Retry, ambiguity, and cancellation

- Matching replay requests resolve to existing accepted work where safe; conflicting replay identities fail closed.
- Clearly transient failures may retry only where the current operation contract establishes that replay is safe.
- Ambiguous side-effecting work is never blindly retried.
- Recovery prefers observation, durable provider identity, or explicit reconciliation over duplicate external work.
- Manual retry preserves prior history and is available only when the recorded failure state permits it.
- Cancellation prevents further local progression when it wins durably.
- If an external provider supports cancellation, ADT may request it and continue observing the accepted task.
- Unsupported, incomplete, or uncertain external cancellation is never presented as proof that external work stopped.

## 7. Connections, providers, and credentials

- Agents reference Connections by stable application identity.
- Connection type determines provider execution, authentication family, safe configuration, model requirements, supported Agent options, and execution capabilities.
- Git is authoritative for current non-secret Connection configuration.
- Provider and tool secret values live in the encrypted repository-scoped Runtime vault and are managed through write-only application flows.
- Workflow snapshots may retain safe credential identity/reference and non-secret configuration required for later execution, but never resolved credential values.
- Unsupported authentication lifecycles, missing current configuration, and unavailable required credentials fail closed.
- Connection configuration, credential availability, model/provider readiness, Runtime readiness, and actual execution success are distinct states.
- Provider model availability is established through the supported provider/Runtime commissioning path rather than assumed from one hard-coded model list.
- Current ordinary Workflow provider execution is mediated by ADT Runtime. Codex Runner remains a separate execution boundary.
- Provider capabilities differ. Some providers expose durable asynchronous task identity and cancellation; others are bounded synchronous operations whose ambiguous submission cannot be safely replayed.
- Local/private provider endpoints such as operator-approved Ollama deployments are reached from Runtime, not directly from the public Worker.
- Delegated providers such as Microsoft Work IQ freeze the selected delegated identity/context with the run so execution cannot silently switch to a different account.
- The provider registry, source, and tests are authoritative for the exact current capability matrix and protocol-specific options.

## 8. Agent tools and Security Profiles

- A read-only policy on an Agent, Workflow, or reused Workflow restricts the enclosing Run. A Workflow can explicitly choose standard authority, subject to any read-only declarations from its Agents or reused Workflows. Advisor and Conversations use the same policy.
- Runtime freezes and enforces read-only policy at admission and execution. Read-only Runs permit explicitly granted native ADT reads and reject external tool grants, Codex execution and continuation, and managed publication. Historical Advisor protections remain in force.
- Knowledge Proposal passes its incoming output through unchanged. Each activation confirmed by the successful execution can expose an independently reviewable response section with stable source provenance. It grants no model publication authority.
- Tool support is an explicit provider capability.
- Tools are a separate configuration domain from provider Connections.
- Artifact Search and native ADT reads are built-in tool capabilities; MCP is the configurable external tool integration.
- Agent grants define maximum tool authority. Workflow block restrictions may narrow grants, require approval, or lower execution budgets but cannot expand them.
- MCP definitions store non-secret endpoint/catalogue/policy information in Git; bearer credentials remain in the Runtime vault.
- New runs freeze the selected non-secret tool contract and credential-binding identity. Later catalogue/server edits affect future runs only.
- Runtime never grants new tool authority by rediscovering tools during Agent execution.
- Tool credentials are resolved only for the exact admitted invocation and are not exposed to the model.
- Trusted policy is independent from ordinary repository write access. Unverified policy changes fail closed at execution boundaries.
- Trusted read-only calls may execute automatically after mandatory checks; unknown, mutating, or sensitive work requires approval unless trusted policy explicitly permits otherwise.
- Human approval identifies one exact frozen invocation, cannot replace arguments, and cannot override a denial or Security Profile restriction.
- Security Profiles contain non-secret trust configuration in Git and separate vault-backed credentials.
- A Security Profile is evaluated after ADT authority/policy and can only further restrict an exact call.
- Missing, unavailable, ambiguous, or negative required security evidence prevents external tool execution.
- Tool proposals, decisions, results, denials, and uncertainty are journaled durably.
- Unknown external tool outcomes block Agent progression for operator reconciliation; timers do not turn uncertainty into permission to re-execute.
- Reconciliation can establish a result, confirmed non-execution, continued uncertainty, or termination without creating a second admitted call.
- Tool and recovery operations remain bounded by run/Agent budgets.
- Detailed policy, approval roles, provider/tool limits, and recovery operations are documented in [Agent tools and recovery](../docs/agent-tools-and-recovery.md).

## 9. Codex execution boundary

- Codex execution is distinct from ordinary model-provider execution and remains behind independently deployed Codex Runner.
- Artifact Toolkit does not store the Runner's ChatGPT/Codex credential.
- Split mode is the reference security design.
- The **Controller** owns ADT-facing admission, durable job/idempotency control, emergency control, and internal signing authority.
- The **Executor** owns Codex identity and model-directed command execution inside its constrained container.
- The **Repository Manager** alone owns trusted managed-repository Git state and authenticated Git transport.
- Controller-signed internal requests can be verified by Executor and Repository Manager; neither role can mint Controller authority.
- Executor never receives GitHub installation credentials, Controller signing authority, Repository Manager private Git state, or infrastructure restart credentials.
- Executor and Repository Manager use separate network/credential paths.
- Codex identity is intentionally inside the Executor trust boundary; that identity does not grant ADT, GitHub, or infrastructure authority.
- Runner jobs are durably identifiable and protected against duplicate execution.
- Temporary observation failure or Runner replacement does not silently recreate accepted side-effecting work.
- Emergency stop and cancellation preserve uncertainty rather than claiming work has stopped without evidence.
- Detailed deployment, storage, network, and recovery behaviour belongs in [Codex Runner](../codex-runner/README.md).

## 10. Runner workspaces and managed Git publication

- Ordinary Runner environments are operator-provisioned private workspaces referenced by safe application-visible identity.
- Ordinary workspaces may retain changes between jobs, but ordinary Workflow jobs do not automatically gain Git publication authority.
- Managed repository environments separately bind a trusted repository and base branch.
- Executor sees the task workspace; Repository Manager retains trusted Git control state, publication state, and credentialed remote authority.
- Managed repository identity comes from trusted configuration and frozen run context rather than model-selected remotes or credentials.
- Artifact and managed code repositories may be different; authority for one is never silently reused for the other.
- Short-lived GitHub credentials may transit the trusted Runtime/Controller/Repository Manager path for the exact admitted operation, but never enter Executor or durable Runner task state.
- The explicit **Publish GitHub PR** block is the only normal Workflow operation that requests managed publication.
- Publication may create or update the one validated ADT-managed pull request associated with its task. It does not merge, force-push, or adopt arbitrary model-selected branches/remotes.
- Empty new managed work does not create a meaningless publication.
- Continuation may use only the previously validated managed association.
- Ambiguous publication is reconciled against the same durable task/association rather than creating another branch, push, or pull request.

## 11. Observability and operational safety

- Workflow/run state is visible to authorised users without exposing credentials or unrestricted private execution content.
- Failures preserve bounded safe categories and correlation evidence sufficient to distinguish relevant application, Runtime, provider, tool, and Runner boundaries.
- Safe diagnostics never make raw external payloads, prompts, credentials, private paths, or arbitrary exception text authoritative application data.
- Provider-side failure is not presented as application authorisation failure when the distinction is known.
- Runtime storage/readiness, provider readiness, tool readiness, Security Profile readiness, and Runner readiness remain independently observable where useful.
- Sensitive native ADT observability reads require an explicit grant and exact-call human approval.
- Native read tools remain repository-scoped, bounded, and unable to mutate, approve, retry, reconcile, or publish.
- Parallelism, cycles, composition, approvals, model/tool budgets, and external calls remain bounded.
- There is no Workflow scripting language, implicit autonomous Agent routing, scheduled autonomous execution, or automatic production promotion of Workflow definitions.
- Non-managed Codex jobs do not publish Git commits or pull requests.

## 12. Historical run boundary

- Current definitions use semantic v2 graphs and current runs use the current execution contract.
- Retired historical run formats remain viewable but read-only.
- Historical runs cannot create new provider, tool, approval, credential, or repository work.
- Historical decoders may interpret immutable persisted snapshots but never grant current execution authority.
