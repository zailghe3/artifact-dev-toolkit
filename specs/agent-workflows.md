# Artifact Toolkit — Agent Workflows Specification

**Document status:** Baseline specification of implemented Agent Workflow behaviour  
**Scope:** Current behaviour only; not a roadmap or implementation design  
**Last updated:** 2026-08-31

## 1. Purpose

- Agent Workflows let users run a bounded graph of configured Agents and deterministic control blocks.
- The framework owns execution order, durability, retry, cancellation, history, and visibility.
- Agents own reasoning and text generation through their configured connection and prompt.
- Agent Workflows are not an autonomous multi-agent system.
- Implementation technologies, storage schemas, protocol details, and deployment mechanics are outside this specification.

## 2. Core concepts

- A **Connection** identifies an available execution provider without exposing its private credentials.
- An **Agent** selects a connection, prompt, and supported provider options.
- An Agent prompt is either custom text or a reference to an Artifact Library prompt.
- A **Workflow** is a v2 semantic graph of versioned blocks and edges.
- A **Block Registry** defines the supported versioned block contracts; backend-executable blocks are Agent references, deterministic text Conditions, deterministic Join barriers, resumable human Approval gates, and reusable Workflow composites.
- A **Workflow layout** is an optional visual arrangement of stable node identities and is not executable configuration.
- A **Run** freezes the workflow and agent configuration used for one execution.
- An **Attempt** records one execution attempt for a workflow step.
- Provider task identifiers may be retained when needed to safely observe or reconcile external work.

## 3. Workflow definitions

- Current Workflow definitions use the ADT-owned v2 semantic graph format.
- Current executable v2 workflows contain one connected bounded graph with Agent blocks, bounded `contains` Conditions, structured parallel fan-out and Join, and Condition-controlled cycles. Condition routes have labelled `true` and `false` semantic ports; omitted ports retain the registered defaults for compatible definitions. Unsupported block contracts or graph topology fail closed before persistence or execution.
- A Workflow may be exposed as a reusable block. `subworkflow@1` references one exposed Workflow in the same definition repository and has one text input and one text output.
- A reusable Workflow block may be the compact graph's successful terminal. Its child's terminal text is the block output, and launch-time composition must still produce a primitive graph whose successful terminal is an Agent.
- Reusable Workflows may compose other exposed Workflow v2 definitions within a bounded depth. Missing, unexposed, cyclic, oversized, or unsupported composed graphs fail closed before launch.
- A run freezes the complete transitive Workflow definitions, exact repository revisions, authored composite paths, and Agents before execution. Later edits to a referenced Workflow affect new runs only.
- Semantic edges determine v2 execution order independently of node array order and visual position.
- Each workflow has bounded step count and execution limits.
- Workflow definitions are separate from run history.
- A run uses an immutable snapshot of the definitions selected at launch.
- Referenced prompt artifacts are resolved at launch and their text is frozen into the run; later prompt edits affect new runs only.
- Tool-enabled runs also freeze the authorised repository identity and catalogue scope without persisting repository credentials.
- The safe connection snapshot includes Git provenance and any secret reference needed for later server-side resolution, but never the resolved credential.
- Later Git connection changes do not alter an existing run's snapshotted runtime, model, or secret reference.
- Changes to an Agent or Workflow do not rewrite the configuration of an already-created run.
- Definition reads use canonical root-level `agents/` and `workflows/` locations only.
- Definitions are discovered and mutated only in the root-level executable definition namespaces.
- Definition location does not affect Workflow references, execution, or immutable run snapshots.
- Executable Agent and Workflow lifecycle state remains independent from Artifact Library Markdown lifecycle rules.
- The Workflow view presents distinct Agent, Condition, Approval, and Join blocks with ADT semantic ports and edges, including structured fan-out and controlled back-edges.
- Users may move visual nodes, pan or zoom the view, and save that layout independently from the Workflow definition.
- Missing or out-of-date layout information does not prevent a current Workflow step from being displayed or executed.
- Visual position and viewport changes remain separate presentation-only layout mutations and never change semantic order, handoff, result selection, limits, or run snapshots.
- For v2 workflows, adding, removing, configuring, connecting, or disconnecting a block is an intentional semantic Workflow mutation and must produce a valid bounded graph; the editor exposes Agent, Condition, structured fan-out, Join, controlled back-edge, and explicit execution-bound authoring.
- At launch, a supported v2 graph is frozen with its semantic Workflow, Workflow revision, Agent revisions, Connection snapshots, and an explicit execution-engine version.
- Reusable Workflow blocks expand into the existing primitive graph within the parent run. They do not create a separate run, checkpoint, cancellation lifecycle, provider authority, or execution count.
- The root Workflow execution limit applies to every expanded Agent, Condition, Join, and Approval activation. Embedded Workflow limits do not establish another budget.
- Current runs use frozen semantic edges to reconstruct graph execution from the immutable versioned plan. Historical v1 snapshots retain their original identity and interpretation only for read-only presentation.

## 4. Linear v2 graph handoff

- The first Agent in a linear v2 graph receives the user's initial Workflow input.
- Each later Agent in that linear graph receives the previous Agent's persisted textual output.
- The framework does not implicitly summarise, rewrite, trim, parse, or reinterpret a successful handoff.
- Provider-specific framing may combine the resolved Agent prompt with the workflow input while preserving the input content required by the provider contract.
- Step output is bounded textual content suitable for persistence and handoff.

## 5. Durable execution

- Runs persist their current state and execution history.
- `approval@1` pauses a run in an explicit waiting-for-approval state with its immutable message and exact reviewed text visible to an authorised user. Approval passes the incoming text onward unchanged and counts as one semantic block execution across pause and resume.
- Approval resumes the exact frozen execution checkpoint and launch snapshot. Later definition edits cannot change a paused run.
- Human waiting does not consume the bounded active execution duration. Cancellation remains available while waiting and prevents downstream admission when it wins durably.
- Approval decisions identify one exact block activation and are idempotent. A stale decision cannot approve a later visit to the same block.
- One active Approval interrupt is supported per run; Approval within a parallel fan-out is rejected. Generic graph runs present their immutable semantic snapshot, simultaneous active Agents, and visit-aware Agent attempt history without implying a linear step order.
- Composition preserves the current direct structured-parallel limitation and rejects composed topology that would introduce unsupported nested parallelism or simultaneous Approval interrupts.
- Run activity and Approval requests within reusable Workflows remain attributable to meaningful frozen composite paths, including repeated invocation identity, and never appear as independent child runs.
- For new v2 runs, durable graph state determines which node executes next. Run cursors are projections and cannot independently select a node.
- Each graph node still executes through the existing provider-neutral Agent lifecycle. A repeated request for a durably successful node reuses its output, and an accepted asynchronous provider task is observed rather than recreated.
- Successful step output is persisted before later steps can depend on it.
- Application or process interruption must not require a completed step to be repeated merely because the original request ended.
- External provider work with a known task identity is observed rather than recreated.
- A generic graph branch failure stops new work admission and remains the run outcome only after already-admitted sibling provider work reaches a bounded truthful reconciliation outcome.
- Launch and execution state are reconciled conservatively after interruption.
- Terminal runs remain terminal when observed again.

## 6. Duplicate-work protection

- Workflow execution uses stable identities to prevent accidental duplicate external work.
- Replaying the same accepted operation should resolve to the existing work where safe.
- A conflicting replay must fail rather than execute as if it were the same operation.
- Side-effecting provider creation is never blindly retried when the outcome is ambiguous.
- Publication or repository-writing operations are never blindly duplicated after an ambiguous result.
- Recovery should prefer observation and reconciliation over repeating an uncertain mutation.

## 7. Retry behaviour

- Clearly transient failures may retry automatically within bounded limits.
- Automatic retry retains the run and step history.
- Ambiguous side-effecting failures do not retry automatically.
- Manual retry may resume eligible failed work without deleting previous attempts.
- Manual retry does not silently rewrite past run history.
- Retry behaviour is bounded by attempt, duration, transition, polling, and text-size limits.

## 8. Cancellation

- Users can request cancellation of an active run.
- Cancellation prevents further local workflow progression.
- A cancellation accepted before provider work starts prevents that work from being launched.
- When an external provider supports cancellation, the framework may request it and continue observing the accepted task until its state is known.
- Unsupported or incomplete provider cancellation must not be presented as proof that external work stopped.
- Cancellation state remains explicit until the framework can safely determine the relevant local outcome.

## 9. Connections and credentials

- Agents reference connections by stable application-visible identity.
- Git is authoritative for the non-secret identity, name, runtime, provider, model, credential source, and credential reference of a Git-defined connection.
- Authorised users may edit supported non-secret Git fields through revision-aware mutations; stale or ambiguous repository writes fail without retry or silent overwrite.
- Target Git credentials use logical `adt-vault` references. Their values are permanent encrypted ADT state and are managed through a write-only interface.
- Current Git OpenAI connections require an `adt-vault` credential reference.
- Legacy D1 provider rows may remain physically present as inert historical or rollback data, but current discovery, mutation, and execution never use them.
- Credential resolution is source-exact. A Git definition never falls back to same-ID D1 state, and an unavailable vault reference never falls back to a Cloudflare binding or D1 row.
- New Workflow snapshots retain the safe vault credential source and reference. Historical source-less Git and D1 snapshots remain displayable identifiers only and cannot resolve credentials or execute.
- Vault configure, replace, remove, and recover operations verify the observed Git revision and derive the authoritative reference server-side. Stored plaintext is never returned.
- Replacing or removing a vault credential does not mutate Git. Recovery restores the existing reference and cannot overwrite an existing value.
- No current migration UI or API exists for retired D1 or source-less configuration; inert rows and bindings are never resolved for execution.
- Credential plaintext, encrypted envelopes, and key material never pass through the browser, API representation, Git definition, or Workflow snapshot. Provider testing remains a separate explicit operation.
- Definite repository conflicts remove only the newly unreferenced vault value. Ambiguous repository outcomes retain it, are not retried automatically, and require refreshed inspection.
- Connection configuration, credential availability, live provider/model readiness, and ADT Runtime diagnostics are distinct states.
- Saving or executing an Agent fails closed when required live provider configuration is invalid or unavailable.
- Credentials are never stored in Agent, Workflow, or run definitions and never appear in diagnostics or logs.
- The Connections catalogue presents safe readiness summaries and navigation; credential management and explicit provider testing are connection-editor operations.
- Duplicating a Git connection creates an unsaved draft from non-secret configuration. It never copies a credential, revision, or source identity, and persists only through normal validated creation.
- Legacy Codex Cloud environment records remain historical compatibility data and have no user-facing management surface. Codex Runner environments remain operator-managed and discovered from the Runner.

## 10. OpenAI execution connections

- Artifact Toolkit supports the existing `openai-responses` execution path and an additive `openai-agents` OpenAI Agents SDK execution path.
- Current OpenAI execution uses explicit Git connections backed by the encrypted ADT vault.
- The resolved Agent prompt is supplied as provider instructions.
- Workflow input is supplied as the agent input without framework summarisation.
- Provider conversation state and tools are not implicitly enabled by the workflow framework.
- Only bounded textual agent output becomes workflow output.
- Provider reasoning and raw provider responses are not exposed as workflow output.
- The `openai-responses` runtime retains a provider task identity when required for durable polling and cancellation.
- The `openai-agents` runtime completes within one bounded invocation and has no SDK handoffs, persistent SDK Session or conversation, SDK tracing, provider cancellation, or asynchronous provider task.
- Agents are tool-free by default. An Agent may explicitly enable `artifact_search` only with `openai-agents`, and runs snapshot that availability.
- `artifact_search` returns bounded content and safe metadata from the authorised validated Artifact Library. It cannot select a repository, ref, path, URL, or credential.
- Tool authority is scoped to the exact active run attempt and repository snapshot, and uses control-plane-only authority material that is not available to the Runtime.
- A tool-enabled Agent requires the matching Runtime capability before provider execution; tool-free Agents remain compatible with older Runtime deployments.
- Each `openai-agents` invocation uses its resolved credential in an isolated server-side provider configuration and disables provider response storage.
- `openai-agents` provider execution occurs in an independently deployed, stateless ADT Runtime across an authenticated execution boundary.
- The Runtime owns bounded conditional, structured-parallel, and controlled-cycle graph compute but not durable storage, admission, credentials, or provider authority.
- Conditions evaluate only immutable snapshotted configuration and exact incoming text, perform no provider invocation, preserve the text unchanged, and execute only the selected route.
- Durable graph state remains in the application control plane behind exact run-scoped checkpoint authority. Provider execution callbacks additionally require authority for the exact admitted node, graph activation, iteration, and attempt. Runtime replacement requires no local persistent volume.
- Runtime readiness, protocol compatibility, capability availability, and provider execution failure are distinct conditions.
- Authorised users can diagnose Runtime configuration, reachability, request authentication, protocol compatibility, capability availability, and wrapping-key compatibility without invoking a provider.
- Authorised users can explicitly diagnose the bidirectional Runtime callback path through the configured checkpoint, graph-node, and optional Artifact Search gateways. Diagnostic authorities are short-lived, purpose- and target-scoped, cannot authorize execution operations, and permit only bounded read-only prerequisite checks.
- Runtime execution-path diagnostics never create or alter Workflow/checkpoint state, resolve provider credentials, invoke an Agent or provider, search Artifact contents, or access GitHub.
- Runtime commissioning is separate from the provider credential and model Connection Test.
- Application and Runtime rollout may occur independently; compatibility is determined by the explicit protocol and capability contract rather than matching revisions.
- An `openai-agents` failure after provider execution begins is not replayed automatically because no durable provider task identity is available for reconciliation.
- Ambiguous provider execution fails safely rather than creating a second potentially billable invocation.
- Model availability is validated against the authenticated provider rather than assumed from a hard-coded application list.

## 11. Codex execution boundary

- Codex execution is distinct from a normal OpenAI Responses model call.
- The supported self-hosted Codex path is exposed as a `codex-runner` connection.
- The legacy Codex Cloud connection remains readable for compatibility but is unavailable for real execution until a supported server-to-server transport exists.
- Codex connections may remain selectable in configuration so the application can show precise readiness problems.
- Selection does not imply that the connection is currently executable.

## 12. Codex Runner responsibilities

- Codex Runner is an independently deployed execution service.
- The Runner authenticates to Codex independently; Artifact Toolkit does not store its ChatGPT/Codex credential.
- Runner environments are pre-provisioned by the operator.
- Artifact Toolkit references a Runner environment by its safe public key rather than supplying arbitrary filesystem paths.
- The Runner decides the private working directory and whether an environment is read-only or workspace-write.
- An Agent may select only provider options that the live Runner reports as supported.
- Interactive approval requests are not part of normal Workflow execution.
- The Runner returns only bounded final agent text to the Workflow.
- Split deployments isolate the ADT-facing control plane from the process allowed to execute model-generated commands.
- The executor never receives the ADT Runner credential, a credential capable of authenticating controller requests, durable controller state, or infrastructure restart credential.
- Split-mode public network access traverses the trusted egress boundary; broad public access and executor-readable Codex authentication material remain an explicit residual data-exfiltration risk rather than a data-loss-prevention guarantee.

## 13. Codex Runner workspace boundary

- A Runner workspace may be a normal directory or a Git checkout.
- Git availability is an execution aid and diagnostic capability, not a requirement for every workspace.
- Artifact Toolkit and the Runner do not automatically clone, reset, pull, branch, commit, push, or create pull requests for ordinary Workflow jobs.
- Persistent workspaces may contain changes from previous jobs.
- Workspace provisioning and reset policy remain operator responsibilities.
- The application may expose bounded workspace diagnostics such as readiness, Git availability, repository presence, current revision, and clean/modified state.
- Workspace diagnostics must not expose private paths, repository remotes, filenames, credentials, or arbitrary command output.
- Execution-boundary health is an advisory signal independent of workspace readiness and Codex authentication.
- The application may show bounded sandbox availability, backend, and safe failure classification without changing Agent save, Workflow admission, or environment readiness.
- Sandbox preflight must be non-destructive, must not contact provider or repository services, and must not change Runner security settings.

## 14. Codex Runner job behaviour

- Runner jobs are durably identifiable and protected against duplicate execution.
- Matching replays resolve to the same accepted job.
- Conflicting replays do not execute.
- The Runner currently admits at most one Workflow Codex job at a time.
- The current capability is not a general waiting-job queue.
- A Runner restart does not silently resubmit previously active Codex work.
- Cancellation targets the existing accepted job rather than creating replacement work.
- Temporary polling failure does not cause an accepted Runner job to be recreated.
- Executor replacement makes work associated with the prior executor generation terminal and never causes side-effecting work to replay.

## 15. Runner readiness and operations

- Runner reachability, protocol compatibility, environment readiness, Codex authentication, model discovery, and job execution readiness are distinct conditions.
- Failure in one readiness dimension should produce a specific safe status where possible.
- The application can expose bounded Runner operational history and status to authorised users.
- After an operational refresh failure, retained history must be clearly identified as stale rather than presented as current state.
- Empty or idle state is shown only when a current successful observation establishes it.
- Deployment, restart, image rollout, mounts, persistent storage, and Runner lifecycle remain operator-owned.
- An authenticated, persistent emergency stop rejects admission until a deliberate safe resume; resume cannot clear the latch before the hard-restart phase has durably completed, and restart-trigger failure never clears it.
- Operators diagnose sandbox prerequisites before changing container privileges or capabilities.
- Artifact Toolkit CI may build or publish Runner artifacts, but normal application behaviour does not deploy or restart the external Runner.
- Detailed Runner deployment and protocol guidance belongs in [`codex-runner/README.md`](../codex-runner/README.md).

## 16. Safety and observability

- Workflow state is visible without exposing provider secrets or private execution content beyond authorised run output.
- Real Workflow runs retain bounded, versioned orchestration evidence separately from provider diagnostics on Agent attempts; control-plane-to-Runtime and Runtime-to-gateway transport observations remain distinct.
- Orchestration evidence may exist before any Agent attempt is admitted. Transient evidence is cleared after successful recovery, cancellation, or an unrelated terminal outcome, while evidence that belongs to a terminal orchestration failure remains visible on the failed run.
- Run-level orchestration evidence excludes secrets, raw errors, callback bodies, provider data, prompts, and Artifact contents.
- Logs and diagnostics use bounded safe categories and identifiers.
- The protected application diagnostics overview may summarize distinct ADT Runtime and Codex Runner readiness conditions without invoking provider or Codex execution; detailed Runner mutation controls remain on its operational status interface.
- Current Workflow execution readiness requires an authenticated, protocol-compatible ADT Runtime that advertises both provider execution and generic graph capabilities.
- Runner status may derive bounded activity category, count, timestamp, and duration signals from provider lifecycle events, but never exposes their payloads.
- Raw provider error bodies, credentials, tokens, reasoning, private paths, and arbitrary upstream headers are excluded.
- Provider-side failure must not be misrepresented as an application authorisation problem when the distinction is known.
- Ambiguous external outcomes remain explicit rather than being reported as successful, failed, or safely retryable without evidence.


## 17. Current limitations

- Parallel Agent frontiers are conservatively bounded and require exact activation-scoped provider authority.
- There is no mapped execution.
- There is no scripting language inside the workflow definition.
- There is no schema-aware automatic transformation between steps.
- There is no streaming workflow output.
- There is no workflow scheduling.
- There is no autonomous routing between agents.
- There is no automatic production promotion of Workflow definitions.
- Ordinary Codex Runner Workflow jobs do not publish Git commits or pull requests.

## Historical run boundary

- Current Workflow definitions are semantic v2 graphs and current execution uses the generic plan-version-2 LangGraph plan.
- Cloudflare Workflows remains the durable outer shell.
- Historical retired run formats remain viewable but are read only. They cannot retry, resume, rerun, relaunch, approve, cancel providers, resolve retired credentials, or create provider work.
- Historical-only parsers may decode immutable persisted snapshots but never admit current configuration or execution.
