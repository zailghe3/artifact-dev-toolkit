# Artifact Toolkit — Agent Workflows Specification

**Document status:** Baseline specification of implemented Agent Workflow behaviour  
**Scope:** Current behaviour only; not a roadmap or implementation design  
**Last updated:** 2026-08-20

## 1. Purpose

- Agent Workflows let users run a bounded sequence of configured agents.
- The framework owns execution order, durability, retry, cancellation, history, and visibility.
- Agents own reasoning and text generation through their configured connection and prompt.
- Agent Workflows are not an autonomous multi-agent system.
- Implementation technologies, storage schemas, protocol details, and deployment mechanics are outside this specification.

## 2. Core concepts

- A **Connection** identifies an available execution provider without exposing its private credentials.
- An **Agent** selects a connection, master prompt, and supported provider options.
- A **Workflow** defines an ordered sequence of agents.
- A **Run** freezes the workflow and agent configuration used for one execution.
- An **Attempt** records one execution attempt for a workflow step.
- Provider task identifiers may be retained when needed to safely observe or reconcile external work.

## 3. Workflow definitions

- Workflow definitions are explicit and ordered.
- Current workflows are sequential and acyclic.
- Each workflow has bounded step count and execution limits.
- Workflow definitions are separate from run history.
- A run uses an immutable snapshot of the definitions selected at launch.
- Changes to an Agent or Workflow do not rewrite the configuration of an already-created run.

## 4. Sequential handoff

- The first step receives the user's initial workflow input.
- Each later step receives the previous step's persisted textual output.
- The framework does not implicitly summarise, rewrite, trim, parse, or reinterpret a successful handoff.
- Provider-specific framing may combine the configured master prompt with the workflow input while preserving the input content required by the provider contract.
- Step output is bounded textual content suitable for persistence and handoff.

## 5. Durable execution

- Runs persist their current state and execution history.
- Successful step output is persisted before later steps can depend on it.
- Application or process interruption must not require a completed step to be repeated merely because the original request ended.
- External provider work with a known task identity is observed rather than recreated.
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
- Multiple named connections may use the same provider.
- Provider credentials remain server-side.
- Credentials are never stored in Agent or Workflow definitions.
- Credentials, private provider configuration, prompts, workflow input, outputs, and reasoning must not leak through diagnostics or logs.
- Connection readiness is validated independently from the fact that a connection can be selected in an editor.
- Saving or executing an Agent fails closed when required live provider configuration is invalid or unavailable.

## 10. OpenAI Responses connection

- Artifact Toolkit supports an OpenAI Responses connection for model-based agent execution.
- The configured Agent master prompt is supplied as provider instructions.
- Workflow input is supplied as the agent input without framework summarisation.
- Provider conversation state and tools are not implicitly enabled by the workflow framework.
- Only bounded textual agent output becomes workflow output.
- Provider reasoning and raw provider responses are not exposed as workflow output.
- A provider task identity is retained when required for durable polling and cancellation.
- Ambiguous provider creation fails safely rather than creating a second potentially billable task.
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

## 13. Codex Runner workspace boundary

- A Runner workspace may be a normal directory or a Git checkout.
- Git availability is an execution aid and diagnostic capability, not a requirement for every workspace.
- Artifact Toolkit and the Runner do not automatically clone, reset, pull, branch, commit, push, or create pull requests for ordinary Workflow jobs.
- Persistent workspaces may contain changes from previous jobs.
- Workspace provisioning and reset policy remain operator responsibilities.
- The application may expose bounded workspace diagnostics such as readiness, Git availability, repository presence, current revision, and clean/modified state.
- Workspace diagnostics must not expose private paths, repository remotes, filenames, credentials, or arbitrary command output.
- Local execution sandbox health is an advisory signal independent of workspace readiness and Codex authentication.
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

## 15. Runner readiness and operations

- Runner reachability, protocol compatibility, environment readiness, Codex authentication, model discovery, and job execution readiness are distinct conditions.
- Failure in one readiness dimension should produce a specific safe status where possible.
- The application can expose bounded Runner operational history and status to authorised users.
- After an operational refresh failure, retained history must be clearly identified as stale rather than presented as current state.
- Empty or idle state is shown only when a current successful observation establishes it.
- Deployment, restart, image rollout, mounts, persistent storage, and Runner lifecycle remain operator-owned.
- Operators diagnose sandbox prerequisites before changing container privileges or capabilities.
- Artifact Toolkit CI may build or publish Runner artifacts, but normal application behaviour does not deploy or restart the external Runner.
- Detailed Runner deployment and protocol guidance belongs in [`codex-runner/README.md`](../codex-runner/README.md).

## 16. Safety and observability

- Workflow state is visible without exposing provider secrets or private execution content beyond authorised run output.
- Logs and diagnostics use bounded safe categories and identifiers.
- Raw provider error bodies, credentials, tokens, reasoning, private paths, and arbitrary upstream headers are excluded.
- Provider-side failure must not be misrepresented as an application authorisation problem when the distinction is known.
- Ambiguous external outcomes remain explicit rather than being reported as successful, failed, or safely retryable without evidence.

## 17. Current limitations

- Workflows are sequential.
- Workflows are acyclic.
- There is no branching or conditional routing.
- There is no parallel or mapped execution.
- There is no scripting language inside the workflow definition.
- There is no schema-aware automatic transformation between steps.
- There is no streaming workflow output.
- There is no workflow scheduling.
- There is no autonomous routing between agents.
- There is no automatic production promotion of Workflow definitions.
- Ordinary Codex Runner Workflow jobs do not publish Git commits or pull requests.
