# WF-001 durable sequential workflow architecture

## Codex Runner workspace contract

Codex Runner environments are pre-provisioned workspaces. ADT runs Codex in the Runner-configured private working directory with the Runner-authoritative read-only or workspace-write sandbox, preserves Codex changes, supplies Git for repository-aware inspection when the mount is a checkout, and accepts only bounded final textual output.

Neither ADT nor Runner clones or verifies repositories, resets workspaces, pulls main, creates branches, commits, pushes, creates pull requests, or supplies GitHub credentials. Persistent workspaces can contain changes from earlier jobs, so operators must choose their provisioning and reset policy. Workspace Git diagnostics are advisory and never make an otherwise-ready ordinary directory unhealthy.

WF-001 separates durable concerns deliberately. Git stores maintainer-authored draft Agent and Workflow definitions. A run copies safe immutable snapshots into D1, which stores the cursor, attempts, raw input and output, failures, cancellation and terminal result. Cloudflare Workflows receives only `{ runId }` and reloads canonical state at each durable boundary.

Each attempt uses `<runId>:<stepId>:<iteration>:<attempt>` as its idempotency key. An existing provider task is checked rather than started again. A successful output is written to D1 before the cursor advances; the next invocation consumes that exact stored string. Outputs are never returned from durable workflow steps or written to logs.

Connections expose a safe descriptor while credentials and private provider options remain server-only. The included deterministic adapter supports testing and local smoke runs and must not be represented as an AI service. Its production availability is explicitly opt-in.

WF-002 adds the first real provider behind that unchanged boundary. `openai-responses` uses the fixed OpenAI Responses endpoint, a server-only `encrypted D1 provider connection`, and the safely snapshotted deployment model from `D1 provider model configuration`. Every create maps the master prompt to `instructions` and raw persisted input to `input`, sends `background=true` and `store=false`, enables no tools, and persists the returned Response ID for durable GET polling and POST cancellation. Only ordered `output_text` and documented textual `refusal` message fragments become opaque workflow output; reasoning and raw provider objects are discarded. An ambiguous create network or 5xx outcome becomes non-automatically-retryable `provider_start_ambiguous`, because ADT cannot safely create a second billable task without a known Response ID.

The engine is intentionally bounded and sequential. It has no autonomous routing, conditions, loops, parallel work, mapping language or schema-aware handoff. Automatic retry is limited to transient categories, while manual retry preserves history and resumes at the failed step. Cancellation stops local progression; a cancellation racing a step claim converts a provider-free `starting` attempt to `cancelled`, and unsupported external cancellation is reported without claiming external work stopped.

Run launch is a D1 compare-and-set state machine (`unclaimed`, `launching`, `attached`, or `launch_failed`). A client idempotency key resolves to one run, and only the caller that reserves the deterministic `<runId>-g<generation>` Workflow instance ID may create it. A recent `launching` claim has a conservative two-minute lease; after that lease, one compare-and-set takeover may reuse the exact reservation and reconcile either creation or an already-existing instance. Ordinary run-detail observation, including the normal run-status page, can reconcile a stale nonterminal launch after the bounded lease. Attachment and safe launch failure are replay-safe, so an interrupted request cannot permanently strand a queued run.

Automatic transient retries remain inside the attached Workflow generation and use durable 10- and 30-second backoff. Manual retry is separately bounded, preserves all attempts, advances the Workflow generation, and uses the same launch reservation protocol. Provider polling guidance is clamped from one second to fifteen minutes and persisted for replay-stable sleep. Run duration, step duration, poll count, text size, transition count, automatic attempts, and total attempts are bounded.


### Provider credential storage

Provider credentials are never stored in Git. Configured provider credentials are encrypted with AES-256-GCM before persistence in D1. The provider-secret encryption root remains a Cloudflare Worker secret and is never stored in D1. Models are safe D1 connection configuration; provider endpoints remain fixed in application code.

## WF-003 Codex Cloud entry-point foundation

Codex Cloud owns repository execution and GitHub integration. ADT supplies a prompt and a preconfigured Codex environment reference, durably tracks the coding task, and considers the coding step complete only when the resulting pull request is available. ADT stores only safe environment-reference metadata, task identity, user-visible final text, safe task links, publication state, and the PR URL; it never receives the Codex environment's GitHub credential, repository secrets, setup configuration, workspace, commands, patches, or reasoning.

Transport discovery was repeated against the current official OpenAI Codex documentation on 2026-08-08. No documented supported server-to-server lifecycle was available that lets a Cloudflare Worker select a preconfigured environment, create and retrieve a stable Cloud task, obtain its textual result and structured PR metadata, publish a PR, and cancel or reconcile the task. WF-003 therefore follows Path B: **Real Codex Cloud execution is unavailable until OpenAI exposes a supported server-to-server Codex Cloud transport that satisfies the gateway contract.** The production `codex-cloud-primary` connection fails closed and is not a mode of `openai-responses`.

The transport-independent `CodexCloudGateway` supports start, check, optional publication, and optional cancellation. The adapter deterministically composes `<masterPrompt>\n\nTask:\n\n<inputText>` without changing the input bytes. A task ID is persisted before polling, and replay with an ID checks rather than starts. Coding completion and safe output are persisted as `task_completed` before publication. Publication resumes against that task, so a publication failure cannot rerun coding; ambiguous starts and ambiguous publication are non-automatic failures. Success requires structured PR metadata, and the PR becomes the primary external URL while the Codex task link remains auxiliary metadata.

For WF-003 a `codex-cloud` agent is terminal-only. Validation after connection and agent resolution must reject it when any downstream step exists. Environment references contain only a key, display name, external environment ID, and enabled flag. Repository selection, setup, environment variables, secrets, network policy, GitHub access, tests, and PR creation remain authoritative in Codex Cloud. No automatic merge is provided.

### Named provider connections

ADT supports multiple named provider connections. Agents reference one connection by stable connection key. Multiple connections may use the same provider and may independently use the same or different credentials and models. The existing `openai-primary` key remains a valid connection identity for backwards compatibility.

OpenAI model choices are discovered from the authenticated OpenAI `/v1/models` endpoint rather than maintained as a static ADT list. Saving a connection validates that its selected model appears in the list available to the credential; the separate connection test remains the authoritative Responses API compatibility check.

## Provider transport safety invariants

Externally side-effecting provider creation and publication operations must explicitly disable implicit Cloudflare Workflow retries. Read-only provider checks may retain platform retries. A known retryable failure may still create a new, persisted, numbered ADT attempt under the bounded application retry policy; an ambiguous start or publication never does. Future WF-003 publication transport must use the same no-platform-retry boundary rather than inheriting `step.do()` defaults.

Provider request correlation and narrowly validated transport metadata may be persisted for operator diagnostics. Provider credentials and request or response content—including prompts, workflow inputs, outputs, raw bodies, exception messages, and arbitrary headers—must never be included in transport diagnostics. Correlation identifiers are diagnostic metadata, not idempotency keys.
# Codex connection boundary

OpenAI Responses connections are direct OpenAI API model calls and may select a Codex-family API model. They remain distinct from `codex-runner`: the self-hosted, ChatGPT-authenticated execution path used by normal ADT Workflows. The legacy `codex-cloud` key remains readable but deprecated and unavailable.

```text
artifact-dev-toolkit main
        +---- ADT deployment ---> Cloudflare
        +---- Codex Runner image publication
                 |
                 v
        Docker Hub: poulti/adt-codex-runner
                 |
                 | manual / Shepherd refresh
                 v
        home cluster -> cr.pouchet.net -> OpenAI Codex
```

Cloudflare ADT owns application sessions, Workflow state, D1/KV, Access service credentials, the application Runner secret, and orchestration state. The home Runner owns persistent `CODEX_HOME`, ChatGPT/Codex authentication, persistent job metadata, local Codex processes, and preconfigured workspaces. Docker/Portainer owns secret injection, persistent-volume lifecycle, workspace mounts, and container lifecycle. Cloudflare Access authenticates ADT-to-Runner ingress; OpenAI owns Codex model inference.

Production injects the Runner secret from an external Docker/Portainer secret file, never directly in service YAML. `CODEX_HOME=/data/codex` and `CODEX_RUNNER_STATE_DIR=/data/runner` are durable storage retained while images and containers are replaced. The Cloudflare Tunnel and Access Service Auth application are externally provisioned; Access plus the application secret protect the service. App Server stays local over stdio and serves authentication, model discovery, and one real thread/turn for each accepted workflow job. No OAuth token crosses into ADT.

ADT and Runner releases deploy independently. Protocol version 1 and feature capabilities negotiate delayed home adoption; unsupported protocol/features produce **Runner update required** without breaking unrelated providers. An Agent stores only an environment key and optional live-discovered model/reasoning effort. The Runner maps that key to a private canonical `cwd` and fixed `read-only` or `workspace-write` sandbox, always uses `approvalPolicy: "never"`, and returns only the final bounded agent-message text. Jobs are durably idempotent and globally serialized; a restart converts active work to `runner_restarted` without automatic execution. Cancellation is bounded and remains an explicit non-terminal Workflow state while the matching turn quiesces; durable reconciliation targets the same task, while accepted-job polling outages preserve it. Git cloning/provisioning, commits, pushes, pull requests, publication, and interactive approvals are not implemented.

The Agent editor always permits selecting `codex-primary` so it can expose configuration and precise readiness feedback. The Runner's `/v1/environments` catalogue—not legacy Codex Cloud D1 records—is authoritative, and only its public environment key crosses into `adapterOptions.environmentKey`. Runner reachability, capability discovery, job execution, environment discovery/readiness, ChatGPT authentication, and model discovery remain separately represented; environment options survive failed authentication or model discovery. UI selection does not imply executability: saving and execution fail closed against the live Runner, environment, model, and reasoning catalogues. No Agent field accepts a `cwd`, mount/repository path, sandbox override, credential, secret, or authentication material.

Deployment, restart, rollout, Portainer configuration, mounts, and lifecycle of the running home-lab Runner are operator-owned and out of scope for ADT deployment. Image publication may remain automated, but ADT CI/CD must not deploy or restart the home service.
