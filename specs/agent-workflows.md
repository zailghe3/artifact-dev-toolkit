# Artifact Toolkit — Agent Workflows Specification

**Document status:** Baseline specification of implemented Agent Workflow behaviour  
**Scope:** Current behaviour only; not a roadmap or implementation design

## 1. Purpose

- Agent Workflows let users run a bounded graph of configured Agents and deterministic control blocks.
- The framework owns execution order, durability, retry, cancellation, history, and visibility.
- Agents own reasoning and text generation through their configured connection and prompt.
- Agent Workflows are not an autonomous multi-agent system.
- Implementation technologies, storage schemas, protocol details, and deployment mechanics are outside this specification.

## 2. Core concepts

- A **Connection** identifies an execution provider without exposing its private credentials.
- An **Agent** selects a connection, prompt, and supported provider options.
- An Agent prompt is either custom text or a reference to an Artifact Library prompt.
- A **Workflow** is a v2 semantic graph of versioned blocks and edges.
- Supported backend-executable blocks are Agent references, deterministic text Conditions, Join barriers, resumable human Approval gates, reusable Workflow composites, and the explicit managed GitHub publication block.
- A **Workflow layout** is an optional visual arrangement of stable node identities and presentation-only edge waypoints; it is not executable configuration.
- A **Run** freezes the Workflow, referenced definitions, Agents, and connection context used for one execution.
- An **Attempt** records one execution attempt for an Agent activation.
- Provider or Runner task identities may be retained when needed to observe or reconcile accepted external work safely.

## 3. Workflow definitions

- Current Workflow definitions use the ADT-owned v2 semantic graph format.
- Executable graphs may contain Agents, bounded text Conditions, structured parallel fan-out and Join, Approval gates, reusable Workflows, and Condition-controlled cycles within the supported topology and execution bounds.
- Unsupported block contracts, invalid ports, disconnected graphs, unsupported nested topology, or exceeded bounds fail closed before persistence or execution.
- A Workflow may define optional starter input for manual launch.
- A Workflow may expose itself as a reusable block. Reusable Workflows expand into the parent run rather than creating child runs.
- Reusable Workflow composition is bounded. Missing, unexposed, cyclic, oversized, or otherwise unsupported composition fails closed before launch.
- Semantic edges determine execution independently of node array order and visual position.
- Visual node positions, viewport state, and edge waypoints are presentation-only and never change semantic topology, execution order, handoff, result selection, execution limits, or run snapshots.
- Semantic and presentation changes are persisted separately. Missing or stale layout data does not make an otherwise current Workflow unexecutable.
- A Workflow execution limit is an integer of at least one; an empty authoring draft normalises to one when saved.
- Definitions and layouts use revision-aware Git mutations so stale or ambiguous writes fail safely.
- Current executable definitions are discovered and mutated only in the canonical root-level definition namespaces.

## 4. Run snapshots and handoff

- Launch freezes the complete current Workflow definition, transitive reusable Workflow composition, relevant repository revisions, Agents, connection snapshots, and resolved prompt artifacts.
- Later edits to definitions, Agents, prompts, or connections affect new runs only.
- Snapshots retain only safe connection identity and secret references required for later server-side resolution; resolved credentials are never stored in a run definition.
- Tool-enabled runs also freeze the authorised repository identity and catalogue scope without persisting repository credentials.
- The first Agent on a linear path receives the user's Workflow input.
- A later Agent receives the persisted textual output selected by the graph path.
- Graph handoff remains the Agent's primary input. A Workflow Agent block may separately publish its successful textual output for explicit use as reference context by structurally later Agent blocks.
- A Workflow Agent block may add the immutable initial run request and selected published outputs from prior successful activations. Unavailable selected outputs are omitted until that source has successfully executed on the current run and path.
- Context selection does not create an edge, dependency, execution order, or provider conversation. In a cycle, a selection resolves to the latest successful published output already available before that activation.
- Selected context is included verbatim in deterministic framing after the primary input; the framework does not implicitly summarise, rank, rewrite, or truncate it.
- Context publication and selection are frozen with the run snapshot. Reusable Workflow selections remain local to their authored Workflow, while the initial request always means the root run input.
- Workflow Agent blocks with no active context settings retain existing handoff and Runtime-compatibility behaviour, including blocks that previously used and then cleared context settings.
- Workflow Context Selection and Codex Conversation Continuation are independent: context adds reference material, while continuation selects a prior provider conversation; graph handoff remains the new turn prompt in both cases.
- A Codex Runner Agent block may explicitly continue a compatible, structurally earlier Codex Agent execution from the same run. Existing blocks without this setting always start a fresh conversation.
- Conversation relationships are semantic Workflow settings frozen with the run snapshot. References authored inside a reusable Workflow remain local to that Workflow when it is composed.
- One conversation lineage is an ordered chain. Independent parallel appends to the same lineage are rejected before execution.
- The application durably binds each continuation attempt to one exact successful source execution, while raw provider conversation identities remain private to Codex Runner.
- If the selected conversation cannot be resumed, execution fails explicitly and never starts a replacement conversation.
- Managed Git conversation continuation requires the exact source execution to have an authorised published branch and pull-request association. Later publication updates that same branch and pull request.
- The framework does not implicitly summarise, rewrite, trim, parse, or reinterpret a successful text handoff.
- Reusable Workflow blocks expose their successful terminal text as their block output while remaining part of the parent run and execution budget.

## 5. Durable execution

- Runs persist current state and execution history.
- Cloudflare Workflows provides the durable outer lifecycle; current graph sequencing is reconstructed from the frozen v2 plan through ADT Runtime.
- Durable graph state, Agent admission, provider-safety state, and recorded outcomes remain controlled by the application rather than by an execution service.
- A repeated request for work that is already durably successful reuses the recorded result rather than repeating it.
- Successful output is persisted before downstream work can depend on it.
- Application or process interruption must not require completed work to repeat merely because the original request ended.
- External work with a known durable task identity is observed or reconciled rather than recreated.
- Branch failure stops new work admission and reconciles already-admitted sibling work before a truthful terminal outcome is reported.
- Terminal runs remain terminal when observed again.

### Approval

- `approval@1` pauses a run in an explicit waiting-for-approval state with immutable review text visible to an authorised user.
- Approval passes the reviewed input onward unchanged and counts as one semantic block execution across pause and resume.
- Approval resumes the exact frozen execution state; later definition changes cannot alter a paused run.
- Human waiting does not consume active execution duration.
- Approval decisions identify one exact block activation and are idempotent; stale decisions cannot approve a later visit to the same block.
- One active Approval interrupt is supported per run; unsupported simultaneous approval topology fails before execution.
- Cancellation remains available while waiting and prevents downstream admission when it wins durably.

## 6. Duplicate-work protection

- Workflow execution uses stable identities to prevent accidental duplicate external work.
- Matching replays resolve to existing accepted work where safe.
- Conflicting replays fail rather than execute as though they were the same operation.
- Side-effecting provider or repository mutations are never blindly retried when their outcome is ambiguous.
- Recovery prefers observation and reconciliation over repeating uncertain external work.

## 7. Retry behaviour

- Clearly transient failures may retry automatically within bounded limits.
- Automatic retry retains run and attempt history.
- Ambiguous side-effecting failures do not retry automatically.
- Manual retry may resume eligible failed work without deleting previous history.
- Retry remains bounded by the current execution and provider contracts.

## 8. Cancellation

- Users can request cancellation of an active run.
- Cancellation prevents further local Workflow progression when it wins durably.
- Cancellation accepted before provider work starts prevents that work from being launched.
- When an external provider supports cancellation, the framework may request it and continue observing the accepted task until its state is known.
- Unsupported or incomplete external cancellation must not be presented as proof that external work stopped.
- Cancellation remains explicit until the framework can safely determine the relevant local outcome.

## 9. Connections and credentials

- Agents reference connections by stable application-visible identity.
- A connection type determines the execution adapter, authentication kind, safe provider configuration, model requirements where applicable, supported Agent option family, and execution capabilities; Agents do not select a separate Agent type.
- Git is authoritative for current non-secret connection configuration.
- Current API-key provider credentials use logical ADT-vault references; credential values are permanent encrypted application state and are managed through a write-only interface.
- Unsupported connection authentication lifecycles fail closed and never fall back to API-key handling.
- Credential resolution is source-exact and never falls back to retired or same-ID historical state.
- Workflow snapshots may retain the safe credential source/reference and validated non-secret provider configuration required for later execution, but never resolved credentials or secret configuration.
- Credential plaintext, encrypted envelopes, and key material never pass through user-authored Agent/Workflow definitions or client-facing connection representations.
- Saving or executing an Agent fails closed when required current configuration or live provider readiness is unavailable.
- Connection configuration, credential availability, provider/model readiness, ADT Runtime readiness, and Codex Runner readiness are distinct states.
- The Connections catalogue shows safe summaries; credential management and explicit provider testing are connection-editor operations.
- Duplicating a Git connection creates an unsaved non-secret draft and never copies credentials, revision identity, or source identity.
- Retired provider rows and legacy Codex Cloud configuration may remain readable as historical data but are not current execution inputs.

## 10. OpenAI execution connections and ADT Runtime

- Artifact Toolkit supports the direct `openai-responses` execution path and the independently deployed `openai-agents` path.
- Current OpenAI execution uses Git-defined connections backed by the encrypted ADT vault.
- The resolved Agent prompt is supplied as provider instructions and Workflow input is supplied as Agent input without framework summarisation.
- Only bounded textual Agent output becomes Workflow output; provider reasoning and raw provider responses are not exposed as Workflow output.
- `openai-responses` may retain a durable provider task identity for polling and cancellation.
- `openai-agents` is one bounded synchronous invocation with no framework-enabled SDK handoffs, persistent SDK conversation/session, tracing, asynchronous provider task, or provider cancellation identity.
- An OpenAI Agents Agent may configure one bounded execution timeout; runs use the snapshotted Agent setting. Transport and infrastructure allowances are derived/internal rather than additional user settings.
- Agents are tool-free by default. An Agent may explicitly enable `artifact_search`, which returns bounded content and safe metadata only from the authorised snapshotted Artifact Library context.
- Tool authority is limited to the exact active run attempt and repository snapshot and is not available as broad repository authority inside Runtime.
- ADT Runtime performs bounded graph computation and execution-heavy provider work but owns no durable Workflow state, admission policy, broad repository authority, or persisted provider credentials.
- Durable checkpoints and executable Agent-node admission stay behind narrow control-plane gateways. Runtime replacement requires no local persistent application state.
- Structured Runtime failures cross durable boundaries only as bounded, validated, non-sensitive data. Runtime transport and callback-gateway evidence remain distinguishable.
- Graph progression is recoverable through durable checkpoints and admission state. A synchronous provider invocation whose outcome becomes ambiguous after provider entry is not automatically repeated because there is no durable provider task identity to reconcile.
- Runtime readiness, protocol compatibility, capability availability, execution-path readiness, provider connection readiness, and provider execution failure are distinct conditions.
- Authorised users may explicitly test the Runtime callback path without creating Workflow state, resolving provider credentials, invoking an Agent/provider, searching Artifact content, or accessing GitHub.
- Application and Runtime may roll independently; compatibility is determined by their explicit protocol/capability contract rather than matching revisions.
- Model availability is validated against the authenticated provider rather than assumed from a hard-coded application list.

## 11. Codex execution boundary

- Codex execution is distinct from a normal OpenAI model call.
- The supported self-hosted path is exposed through a `codex-runner` connection.
- Codex Runner authenticates to Codex independently; Artifact Toolkit does not store the Runner's ChatGPT/Codex credential.
- Current supported connections remain visible with explicit readiness problems when temporarily unavailable; visibility does not imply executability.
- Legacy Codex Cloud connections remain historical/read-only configuration and are not offered for new executable setup.

## 12. Codex Runner responsibilities and split security model

- Codex Runner is independently deployed. Split mode is the reference security architecture; integrated mode remains a compatibility deployment.
- The **Controller** owns ADT-facing admission, durable job/idempotency state, emergency control, and internal signing authority. It does not execute model-generated commands.
- The **Executor** owns Codex identity and model-directed command execution inside its constrained container.
- The **Repository Manager** owns trusted managed Git state and authenticated Git transport. It never executes model-generated commands.
- Controller-signed internal requests are verified by Executor and Repository Manager; neither role receives material that can mint controller requests.
- In split mode the Executor container is the execution security boundary. Admitted `workspace-write` work may run with Codex full access inside that constrained container; split execution does not depend on a native Codex sandbox.
- The Executor never receives the ADT Runner credential, GitHub installation credentials, Controller signing authority, durable Controller state, Repository Manager private Git state, or infrastructure restart credentials.
- Executor network access is restricted to required Codex/model-auth services. Repository Manager uses a separate network and credential path for managed Git operations.
- Codex identity material belongs to the Executor trust boundary: model-directed execution may be able to read Executor-visible Codex state, but that does not grant ADT, GitHub, or infrastructure authority.
- Runner returns only bounded final Agent text and bounded safe operational metadata to ADT.

## 13. Runner workspaces and managed repositories

- An ordinary Runner environment is an operator-provisioned private workspace referenced by a safe public key; ADT never supplies an arbitrary filesystem path.
- Ordinary workspaces may be normal directories or Git checkouts, may retain changes between jobs, and are reset/provisioned according to operator policy.
- Git availability is an execution aid for ordinary workspaces, not automatic publication authority.
- ADT and Runner do not automatically clone, reset, pull, branch, commit, push, or create pull requests for ordinary Workflow jobs.
- A managed repository environment is separately trusted operator configuration that binds an environment to one repository and base branch.
- Managed execution exposes only the task workspace to the Executor. Repository mirrors, Git control data, durable task authority, and publication state remain private to Repository Manager.
- Managed repository identity and allowed continuation association are determined by trusted configuration and durable application state rather than by model-selected remotes, branches, or credentials.
- Workspace and execution-boundary diagnostics are bounded and must not expose private paths, remotes, filenames, credentials, arbitrary command output, or unsafe upstream data.

## 14. Codex Runner job behaviour

- Runner jobs are durably identifiable and protected against duplicate execution.
- Matching replays resolve to the same accepted job; conflicting replays do not execute.
- The current Runner admits at most one Workflow Codex job at a time and is not a general waiting-job queue.
- A Runner restart or Executor replacement does not silently resubmit prior side-effecting work.
- Temporary observation failure does not recreate an accepted job.
- Cancellation targets the existing accepted job and does not report success until the relevant work is known to be quiescent.
- An uncertain acknowledgement from a side-effecting Codex turn start is reconciled against that same turn rather than retried as a second turn. Unresolved ambiguity remains explicit.

## 15. Runner readiness and operations

- Runner reachability, protocol compatibility, environment readiness, Codex authentication, model discovery, execution-boundary readiness, and job readiness are distinct conditions.
- Failure in one dimension should produce a specific bounded safe status where possible.
- The application may expose bounded Runner operational history, storage status, backups, and diagnostics to authorised users.
- Retained observations after refresh failure are identified as stale rather than presented as current state.
- Live Codex SQLite state remains on Executor-local filesystem storage, separate from durable non-SQLite Codex home state.
- Runner supports consistent durable SQLite backups and a confirmed restore operation that refuses active work, quiesces App Server before mutation, validates backup integrity, and leaves unrelated durable home/workspace state untouched.
- An authenticated persistent emergency stop rejects new admission until deliberate safe resume. Failure to complete required hard-restart recovery never silently clears the stop.
- Deployment, restart, image rollout, mounts, persistent storage, and Runner lifecycle remain operator-owned.
- Detailed deployment, storage, protocol, and recovery guidance belongs in [`codex-runner/README.md`](../codex-runner/README.md).

## 16. Managed GitHub publication

- A Codex Runner Agent may opt into a trusted managed repository environment.
- The managed repository identity and base branch are bound from trusted Runner configuration and current run context before execution.
- Artifact and managed code repositories may be the same or different; authority for one is never silently reused as authority for the other.
- Executor has no GitHub installation credential or trusted remote authority. Repository Manager is the only managed Git transport.
- Short-lived repository credentials may transit the trusted Controller/Repository Manager path for the exact operation, but are not persisted in Runner job/task state and never enter the Executor.
- Managed repository metadata is checked before execution and publication. Identity drift or boundary mutation fails closed without adopting model-created Git authority.
- The explicit **Publish GitHub PR** block is the only Workflow operation that may request managed publication.
- Publication may create or update the one validated ADT-managed draft or ready pull request associated with its source managed task. It does not merge, force-push, or adopt arbitrary branches/remotes.
- A new managed task with no changes does not create a branch or pull request.
- Continuation may use only the previously validated managed association; caller-selected or model-selected branch substitution fails closed.
- Ambiguous push/publication outcomes are reconciled against the same deterministic managed task and association rather than blindly repeated.
- Safe Workflow state may retain task, branch, commit, and pull-request association metadata but never installation credentials.

## 17. Safety, observability, and current limitations

- Workflow state is visible without exposing provider secrets or private execution content beyond authorised run output.
- Real runs may retain bounded run-level orchestration evidence separately from provider diagnostics on Agent attempts.
- Orchestration evidence excludes secrets, raw errors, callback bodies, provider data, prompts, Artifact contents, private paths, and credentials.
- Runner status may expose bounded activity category/count/timestamps but never provider lifecycle payloads, commands, arguments, reasoning, prompts, or file content.
- Provider-side failure must not be misrepresented as application authorisation failure when the distinction is known.
- Ambiguous external outcomes remain explicit rather than being reported as safely retryable without evidence.
- Parallel Agent frontiers are bounded; unsupported nested parallel/Approval topology fails closed.
- There is no mapped execution, Workflow scripting language, schema-aware automatic transformation, streaming Workflow output, Workflow scheduling, or autonomous Agent routing.
- There is no automatic production promotion of Workflow definitions.
- Non-managed Codex Runner Workflow jobs do not publish Git commits or pull requests.

## Historical run boundary

- Current Workflow definitions are semantic v2 graphs and current execution uses the current generic graph plan.
- Historical retired run formats remain viewable but are read only.
- Historical runs cannot retry, resume, rerun, relaunch, approve, cancel providers, resolve retired credentials, or create new provider/repository work.
- Historical-only parsers may decode immutable persisted snapshots but never admit current configuration or execution.
