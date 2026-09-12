# ADT Codex Runner

The ADT Codex Runner is an independently deployed, shared-secret-protected bridge to the pinned Codex App Server. It provides bounded Codex execution for ADT Agent Workflows.

The packaged Codex binary is an experimental GNU/glibc build. It is neither release-equivalent nor an OpenAI-published GNU prebuilt artifact.

`release.json` is the canonical source for the packaged Codex version, currently 0.153.4, protocol version, and Runner revision. Build and protocol implementation details remain authoritative in source, tests, and publication workflows.

## Runtime roles and Swarm boundary

The same image supports three explicit roles through `CODEX_RUNNER_ROLE`:

- `integrated` is the default, backwards-compatible single-container service. It retains Codex's `read-only` and `workspace-write` Bubblewrap modes and never selects full access.
- `controller` owns the public `/v1` API, ADT shared secret, environment catalogue, durable job/idempotency state, persistent emergency latch, and optional Portainer redeploy webhook. It does not start Codex or mount `CODEX_HOME` or workspaces.
- `executor` exposes only a bounded internal API, runs one Codex execution at a time, and owns `CODEX_HOME` and `/workspaces`. It receives neither the ADT secret nor controller storage or redeploy webhook.

The controller signs every internal request with an Ed25519 private key from `CODEX_RUNNER_EXECUTOR_SIGNING_PRIVATE_KEY_FILE`; the executor receives only `CODEX_RUNNER_EXECUTOR_VERIFYING_PUBLIC_KEY_FILE`. Signatures bind the method, path, exact body, timestamp, and one-use nonce. The executor rejects stale and replayed requests, and executor-visible material cannot mint controller requests. Execution start returns an opaque execution ID and executor generation; the controller polls that identity and separately requests interruption. An executor generates a fresh opaque generation at every process start. Observation failure is not replacement and never permits replay of a possibly side-effecting turn.

Generate the pair outside the stack with `openssl genpkey -algorithm ED25519 -out executor-signing-private-key.pem` and `openssl pkey -in executor-signing-private-key.pem -pubout -out executor-verifying-public-key.pem`. Store only the private PEM as the controller Swarm secret. Supply only the public PEM to the executor configuration.

Internal responses are byte-bounded and exact-shape validated. Executor transport loss, a missing ephemeral execution, or a changed generation reconciles the existing controller job durably as `runner_restarted`; it does not mark controller storage unhealthy. Capacity is released only after that terminal record is written, so a healthy replacement executor can accept later work without restarting the controller while idempotent lookup continues to return the original record.

In Docker Swarm split mode, the executor container is the Codex execution security boundary. The executor maps an admitted `workspace-write` environment to Codex `danger-full-access`; that means full access inside the constrained container, not host access. Split execution must not depend on Bubblewrap or another native Codex sandbox inside the container. Integrated mode may continue to use native Codex sandboxing where the host supports it. Do not use privileged mode, add `SYS_ADMIN`, select an unconfined node policy, or mount the Docker socket.

Executor App Server launches apply Runner-owned highest-precedence overrides: login shells and web search are disabled, inherited command environment is empty, and an explicit allowlist restores only core command variables plus validated HTTP(S)/all/no-proxy settings from the executor deployment. Secret-, token-, key-, password-, credential-, and auth-like names remain excluded, and repository configuration cannot loosen these launch overrides.

`read-only` environments fail closed in split mode. Full access cannot truthfully enforce a read-only workspace without an outer read-only mount, and the controller does not silently weaken that contract. Integrated mode retains existing behavior.

In controller mode environment parsing is configuration-only. Every environment listing and admission performs a bounded executor probe against the canonical cwd; the executor proves read/execute/write access and containment below `/workspaces`. Missing, unwritable, outside-root, read-only, or unreachable workspaces report `ready: false` and are not admitted.

The authenticated App Server uses persistent `CODEX_HOME`. Because split-mode Codex has full access inside the executor container, identity material mounted there may be readable; this is a follow-up hardening concern, not a claim enforced by the current filesystem boundary. The executor contains no controller secret or Repository Manager state and its network cannot reach GitHub or the Repository Manager's GitHub-capable proxy.

## Split deployment and egress

`docker-stack.split.example.yml` demonstrates the intended Portainer/Swarm layout:

- ingress plus controller;
- internal control overlay plus controller and executor;
- a dedicated internal executor-egress overlay shared only by executor and its restricted Squid;
- a distinct internal repository-egress overlay shared only by Repository Manager and its GitHub-capable Squid;
- non-internal uplink overlay plus the two Squid services only.

`internal: true` disables external routing for an overlay. It is unrelated to Compose `external: true`, which says that the network lifecycle is operator-owned. The controller alias `codex-runner` lets an existing tunnel origin such as `codex-runner:8789` continue to resolve after migration. Executor and proxy ports are not published.

The repository-owned Squid services remain the external egress enforcement layer. The executor proxy is fail-closed to the exact required Codex/OpenAI hosts. Repository Manager's separate proxy permits public GitHub transport only after destination-address ACLs reject non-public targets. The role-specific internal overlays prevent either client from resolving or routing to the other role's proxy; neither client joins the uplink. Access logging is disabled so URLs, queries, and credentials are not intentionally recorded. Use the trusted publication image `poulti/adt-codex-runner:<merged Git SHA>` for controller, executor, and Repository Manager.

The executor's restricted proxy allows only required Codex/OpenAI destinations. Repository Manager remains the only role with both Git authority and a route to GitHub.

The proxy uses Canonical verified-publisher `ubuntu/squid:6.6-24.04_edge`, based on Ubuntu 24.04 LTS and supported through May 2029, pinned to the verified multi-platform index digest `sha256:8a3baed477e2c282ab8aa5edad442f69873246964f225c5c2ae8364b6610963c`. The proxy remains part of the trusted boundary and operators must validate the pinned image with their Swarm platform before rollout.

Runner status derives only a bounded coarse activity category/count, last safe activity timestamp, and duration from Codex lifecycle events. It never projects event payloads, commands, arguments, output, prompts, reasoning, or file content. The proxy has no management interface in this topology, so proxy health and allow/deny telemetry remain unavailable; use Docker/Portainer for resource and service monitoring.

`cap_drop: ALL` is shown for executor and proxy and no capabilities are added. Validate it with the exact host/storage setup before rollout. The executor has no uplink network, so removing proxy variables does not create a direct Internet route.

## Emergency stop

Authenticated `POST /v1/control/emergency-stop` first persists the latch, then rejects new admission, cooperatively interrupts/reconciles active work, and finally makes a bounded best-effort POST to the file-backed redeploy webhook. The URL is never returned or logged, redirects are not followed, and only a 2xx response is success. Missing or failed webhook invocation leaves the latch set and reports only a safe reason.

`POST /v1/control/resume` is separate. When a generation was known at stop time, resume requires a healthy, idle executor with a different generation. Controller restart reloads the latch before admission. If redeploy fails, the operator must restart the executor through Portainer, verify the fresh idle generation, and then resume. Normal Cancel remains cooperative. Docker/Portainer remains the resource-monitoring source because the Runner does not receive Docker API access.

Split-mode cancellation and deadlines have a bounded quiescence grace period. A turn that remains active is durably reconciled without replay and triggers the same controller-owned hard-restart hook; integrated mode retains its existing local fail-closed behavior.

## Migration from integrated storage

Before changing the operator-managed stack:

1. Back up and preserve Codex auth/config currently stored in the existing `/data/codex` volume for the executor.
2. Copy `/data/codex/runner-state` into a distinct controller volume mounted at `/data/runner`.
3. Expose the existing `/data/codex/environments.json` as immutable controller configuration at `/run/config/codex-environments.json`.
4. Mount only `CODEX_HOME` and workspaces into the executor. Never mount controller state or environment configuration there, and never mount executor storage into the controller.
5. After verifying the controller copy and backup, remove old `/data/codex/runner-state` and `environments.json` copies from executor storage or mark them explicitly stale and non-authoritative. The executor must not depend on them.

The repository does not automate this migration or deploy the home-lab stack. Operators may substitute NFS-backed named volumes, but must provide their own server/export settings rather than embedding private infrastructure in the stack file.

## Workspace contract

A Runner environment is a pre-provisioned workspace.

- The Runner executes Codex in an operator-configured private working directory.
- Each environment is `read-only` or `workspace-write`.
- Changes in persistent workspaces are preserved until the operator resets them.
- Git tooling is available when the workspace is a Git checkout.
- ADT and Runner do not automatically clone, reset, pull, branch, commit, push, or create pull requests for ordinary workflow jobs.
- GitHub credentials are not supplied to ordinary Runner jobs.
- Workspace provisioning and reset policy remain operator responsibilities.

## Authentication and readiness

- ChatGPT/Codex authentication and `installation_id` belong to the executor and persist in writable `CODEX_HOME=/data/codex`; the controller must not mount that volume.
- ADT does not store the Runner's ChatGPT/Codex credential.
- Connection state, authentication state, model discovery, environment readiness, and job readiness are distinct conditions.
- **Test Codex** performs a bounded authenticated model-turn health check; it is separate from normal workflow execution.
- Health and diagnostic routes expose bounded status only and must not return prompts, model output, reasoning, credentials, protocol IDs, raw upstream errors, or private paths.
- Certificate and hostname verification must not be weakened for connectivity troubleshooting.

## Environment configuration

Set `CODEX_RUNNER_ENVIRONMENTS_FILE` to a read-only JSON configuration file using schema version 1.

```json
{
  "schemaVersion": 1,
  "environments": [{
    "key": "fpo-artifacts",
    "name": "FPO artifacts",
    "cwd": "/workspaces/fpo-artifacts",
    "enabled": true,
    "sandbox": "workspace-write"
  }]
}
```

- `key` is the public stable identifier stored by ADT.
- `name` is the operator-facing display name.
- `cwd` is private Runner configuration and must be an existing absolute directory.
- `sandbox` is `read-only` or `workspace-write`.
- Workflow approval policy is always non-interactive.
- An absent environment file is valid and produces an empty catalogue.
- The public environment descriptor never exposes private filesystem paths.

For Docker or Portainer, mount workspaces and the environment file explicitly. Give the non-root container user only the filesystem permissions required by the selected sandbox. Do not use world-writable workspace permissions.

## Persistent job state

Set `CODEX_RUNNER_STATE_DIR` to persistent storage owned by the non-root Runner user.

- Job identity and idempotency state are persisted before execution can create external work.
- Matching replays resolve to the same accepted job.
- Conflicting replays do not execute.
- Active jobs found after Runner restart become terminal restart failures and are not silently resubmitted.
- The current Runner serializes workflow jobs globally rather than providing a general waiting queue.
- Temporary polling failure does not recreate an accepted job.
- Cancellation targets the existing accepted job.
- If an interrupted Codex turn cannot be confirmed quiescent, the Runner fails closed and requires operator recovery rather than admitting potentially conflicting work.

Exact limits, timeout values, state-file mechanics, and protocol fields are implementation details defined by source and tests.

## Models and Agent options

- ADT uses the Runner's live model catalogue.
- Agents store only safe public environment and model-selection values supported by the Runner.
- Private working directories, credentials, sandbox overrides, and authentication material are not Agent fields.
- Selecting a connection or model in the editor does not guarantee current executability; save and execution validation fail closed against live readiness.

## Diagnostics

`GET /v1/diagnostics/auth-environment` provides bounded operational diagnostics for authentication and transport readiness.

Diagnostics may report safe classifications for:

- Runner/App Server readiness;
- packaged Codex/version consistency;
- runtime/network family state;
- DNS, TCP, TLS, CA, and proxy readiness;
- Codex-home access;
- fixed-path reachability checks.

Diagnostics must not expose addresses, credentials, response bodies, arbitrary headers, certificates, raw socket/TLS errors, raw App Server errors, or Codex protocol output.

`GET /v1/environments/<key>/sandbox-diagnostics` runs pinned Codex 0.153.4's debug sandbox command with an explicit `sandbox_mode` matching the environment and a fixed `true` no-op. This direct command path has no model turn or managed permissions profile; the Runner supplies no network, Git, approval, authentication, or mutation operation. The three-second, 8 KiB byte-bounded probe is non-destructive and advisory. Its response and failure log contain only an allowlisted status, semantic reason, and a backend only when process output identifies it safely.

- Successful Codex authentication does not prove that local tool execution works.
- Filesystem and Git readiness do not prove that the local execution sandbox can initialize.
- Diagnose a sandbox failure before considering container privileges or capabilities; this diagnostic does not recommend or apply such changes.
- Older Runners remain usable and simply do not provide this optional endpoint.

## CI and publication

- Normal repository verification validates Runner source and tests.
- The trusted main publication workflow owns the final Runner image build and offline smoke validation.
- Publication pushes immutable source-SHA tags and `latest` only after successful build and smoke checks.
- The smoke path does not perform live OpenAI authentication or model inference.
- ADT CI may build and publish Runner images but does not deploy, restart, or reconfigure the operator's home Runner.

## Release compatibility

`release.json` defines:

- `protocolVersion` — wire compatibility generation;
- `runnerRevision` — Runner implementation generation;
- `codexVersion` — packaged Codex CLI version.

ADT and Runner Git commits are not expected to match. Compatibility is determined by protocol and required capabilities; revision differences provide rollout/freshness information.

Runner revision 10 makes `turn/start` acknowledgement timeouts ambiguity-safe. The executor retains the unique new thread lifecycle for a bounded notification/late-response reconciliation window, never resends the side-effectful request, and reports unresolved outcomes as `turn_start_ambiguous`. Its structured execution lifecycle logs contain only generation/execution identifiers, bounded categories, counts, states, and elapsed time; they never contain prompts, workspaces, protocol payloads, credentials, or model output.

Cancellation remains pending when an ambiguous turn has no addressable turn ID. The executor retains its execution slot until interruption and execution settlement or executor replacement establishes quiescence; it never converts an unaddressed cancellation into terminal success.

Deploy revision 10 by restarting the Controller and Executor services together. The Repository Manager uses the shared image/revision contract and must be rolled to the same image in split-stack deployments, although its runtime behaviour is unchanged. The separate Cloudflare Workflow to ADT Runtime `0 ms` transport failure remains unresolved and is not changed by this Runner fix.

- Equal supported revisions are current.
- An older installed revision may show an update available.
- A newer Runner may remain compatible with an older ADT deployment.
- Unsupported protocol or required capability remains fail-closed.

Image rollout timing, Docker/Portainer configuration, mounts, persistent storage, and service lifecycle remain operator-owned.

## SQLite storage, backup, and recovery

Codex 0.153.4 supports `CODEX_SQLITE_HOME`; the Runner keeps durable non-SQLite state and live database state on different storage:

- Keep `CODEX_HOME` on durable storage. It may be NFS-backed for authentication/configuration, sessions, installation identity, user-managed material, and ADT backup sets.
- Mount `/data/codex-sqlite` as a writable local Docker volume or block filesystem and set `CODEX_SQLITE_HOME=/data/codex-sqlite`. Never place this path on NFS, NFS4, CIFS, or SMB.
- The executor alone sees both paths. `CODEX_SQLITE_HOME` is inherited by Codex App Server and reinforced with a Runner-owned `sqlite_home` CLI override so a legacy durable `config.toml` cannot take precedence, while it remains excluded from model-directed workflow shell environments by the existing allowlist policy.
- Stop the prior executor/App Server before the first migration so the legacy NFS databases are quiescent. On the first start with an empty SQLite home, the new executor stages and copies legacy SQLite databases plus WAL/SHM recovery sidecars from `CODEX_HOME` before App Server starts. It never deletes the durable source and never overwrites an initialized local store.
- The executor uses SQLite's online `.backup` API into hidden staging directories inside the mounted local SQLite volume, not `/tmp` or the read-only `/data` parent. It verifies SHA-256 checksums, then copies cold standalone databases and a safe manifest to `$CODEX_HOME/.adt/sqlite-backups`. It never copies live WAL/SHM files into a completed backup.
- Backups run every 24 hours and retain 14 completed sets by default. Configure `CODEX_RUNNER_SQLITE_BACKUP_INTERVAL_MS`, `CODEX_RUNNER_SQLITE_BACKUP_RETENTION`, or `CODEX_RUNNER_SQLITE_BACKUP_ROOT` when required.
- Use **Back up now** and **Restore backup** on the Codex Runner status page. Restore refuses active work, validates the selected set, confirms App Server exit, takes a local pre-restore snapshot, replaces SQLite databases only, performs bounded readiness, and rolls back the local snapshot if readiness fails. If rollback cannot be confirmed, the safety copy is retained and execution remains fail-closed for operator recovery.
- During restore or unsafe recovery, executor status remains available but reports unhealthy without starting App Server. If App Server termination cannot be confirmed, SQLite is left unchanged and the executor remains fail-closed; restart or redeploy that executor before resuming work.

A normal Docker volume is node-local in Swarm. Pin the executor with a sufficiently specific placement constraint. If it is rescheduled to a node without that volume, expect an empty local SQLite store and restore a completed NFS backup through ADT. No iSCSI or external storage orchestrator is required.

Use the split stack's long-form `tmpfs` mounts. They create `/tmp` with size `268435456`/mode `01777` and `/run` with size `16777216`/mode `0755`; `/run` is not intended to be writable at its root by UID 1000.

After a Runner code/image change, publish one immutable image and redeploy controller, executor, and repository manager at that same digest/tag. Squid needs no redeploy unless its configuration changed. The ADT Worker must receive the normal ADT deployment for UI/API changes.

## Managed Git workspaces and pull requests

The same immutable Runner image now supports `CODEX_RUNNER_ROLE=repository-manager` in addition to controller and executor. The repository manager is an internal-only signed-RPC service. It mounts the shared task checkout volume at `/workspaces`, its private repository/control volume at `/data/repositories`, and the environment configuration, but not `CODEX_HOME`, SQLite storage, controller state, the public Runner secret, the signing private key, or the redeploy webhook. The executor mounts `/workspaces` but **never** `/data/repositories`. The split stack gives the repository manager the internal control and egress overlays; GitHub traffic therefore uses the existing Squid boundary. It has no published port or Cloudflare route. The private volume is not a secret, and no additional long-lived GitHub or Portainer secret is introduced.

The example uses local Docker volumes. Executor and repository-manager must therefore be constrained to the same unique Swarm node (`node.labels.codex-runner-sqlite == true` in the example); the same volume name on two nodes is two unrelated physical volumes. Keep both `codex-runner-workspace` and the repository-manager-only `codex-runner-repository-state` on that node rather than converting repository authority storage to NFS. The image creates `/workspaces` and `/data/repositories` as mode `0700`, owned by the non-root `node` runtime user, so fresh named volumes initialize safely without root execution or added capabilities.

Managed mode is explicit trusted operator configuration:

```json
{
  "schemaVersion": 1,
  "environments": [{
    "key": "artifact-dev-toolkit",
    "name": "Artifact Dev Toolkit",
    "cwd": "/workspaces/artifact-dev-toolkit",
    "enabled": true,
    "sandbox": "workspace-write",
    "repository": {
      "managed": true,
      "owner": "zailghe3",
      "repo": "artifact-dev-toolkit",
      "baseBranch": "main"
    }
  }]
}
```

At startup, the repository manager safely provisions each enabled managed environment root below the configured workspace root and creates its restricted `tasks` directory. This is idempotent across restarts. Operators must **not** pre-clone a repository or place other content in a managed environment root: existing unexpected content, symlinks, non-directories, and paths outside the workspace root fail closed and keep the environment unready. Ordinary non-managed environment roots remain operator-provisioned.

The repository manager stores trusted mirrors, task Git control directories, sealed commits, and durable task records only below `/data/repositories`; Codex sees at most one standalone managed checkout under `/workspaces/<environment>/tasks/`. Controller admission resolves storage, configuration, environment, idempotency, and the single active-job lease, then durably persists a provisional queued job before asking the Repository Manager to prepare a new task. Lookup can therefore reconcile the stable job identity while Git I/O is still pending. Managed task ID and optional continuation branch participate in the job fingerprint, while the short-lived credential does not. A busy or idempotently retried request cannot seal or remove the active checkout. Preparation failure becomes a safe durable terminal job and is not repeated by the same idempotency key.

Emergency Stop can latch and cancel a provisional job without waiting for repository preparation. If it wins during preparation, Codex execution never starts. Only after the prior job is terminal may admission materialize another task: the previous checkout is committed into its private task Git directory, recorded as sealed, and removed from `/workspaces`. Publish uses that immutable sealed commit and removes any executor-created path that reused the old task name. Repository materialize, seal, publish, inspect, and cleanup transitions are serialized in the Repository Manager.

Authenticated Git commands derive the remote from trusted environment configuration and never consult executor-visible `.git` data. External operations keep `protocol.file.allow=never` and `protocol.ext.allow=never`. Only the credential-free transfer from the internally constructed canonical private mirror path to a private task Git directory enables the local file transport for that single command. Mirror initialization is idempotent, validates its allowlisted bare-repository layout, and rejects unexpected private state. Task preparation builds in a private `.preparing-*` staging directory and atomically promotes the durable record; any recordless partial task is safely rebuilt on the same deterministic retry. Each new task fetches the configured base, resolves an immutable SHA, and creates a deterministic `adt/codex/*` branch checkout. A later managed Agent may continue a persisted ADT pull-request association: ADT resolves its exact trusted head branch, and a new isolated checkout starts at that branch's current remote head without force-pushing. `continueFrom` is an advanced preconfigured Agent option containing only `{runId, publishNodeId}`; editing the Agent preserves it, and no raw branch is accepted.

ADT uses the already-authorised GitHub App installation and exact repository ID to mint separate short-lived credentials for `contents: read`, `contents: write`, and `pull_requests: write`. Git credentials exist only in the repository-manager request and process environment for the bounded operation. They are never placed in argv, remotes, Git config, Runner job/idempotency state, D1, logs, API results, or the Codex environment. Publishing stages changed files, skips empty commits, commits as `ADT Codex Runner <codex-runner@adt.invalid>`, and performs a non-force push. A new unchanged task returns `managed_task_has_no_changes` before ADT mints a pull-request credential, calls the PR API, or records an association. An unchanged continuation may still update the title, body, or draft state of its already-associated PR without a commit, push, or duplicate PR. The first-class **Publish GitHub PR** Workflow block creates or updates the associated draft or ready pull request. A restarted `starting` publication reconciles the exact persisted association or safely re-enters the same deterministic task and branch. Repository/base/head provenance is checked before PR mutation. REST manages title/body and creation; supported GraphQL mutations perform draft-to-ready and ready-to-draft transitions.

The GitHub App must be granted **Contents: write** and **Pull requests: write**. GitHub may require an installation owner to approve the permission change before managed publication becomes available.

This version does not merge pull requests, delete remote branches, accept arbitrary repositories/remotes/refs, force-push or rebase published branches, resolve conflicts automatically, ingest GitHub webhooks, or allow model-authenticated pushes.

## Managed publication isolation (revision 12)

Managed split execution maps admitted `workspace-write` to pinned Codex's `danger-full-access` mode. The image smoke starts the real pinned App Server as both the integrated service and executor role, while a separate direct-shell probe proves workspace writes inside a non-root, capability-free container whose root filesystem is read-only without invoking a native Codex sandbox. MCP servers, Apps, remote control, and hosted/cached/standalone web search remain disabled by immutable App Server overrides. Shell commands additionally receive a restricted environment with system Git credential discovery disabled. A bounded non-symlink-following pre/post audit rejects `.git` metadata anywhere below the managed workspace.

Split deployments use `squid-executor.conf` for fail-closed executor egress. It permits CONNECT only to the exact model/auth hosts `api.openai.com`, `auth.openai.com`, and `chatgpt.com`; IP literals, private/reserved addresses, GitHub, relays, and every other destination are denied. Repository Manager continues to use the separate control-plane proxy and remains the only role able to fetch or push GitHub. This separation, rather than the defense-in-depth prompt, is the remote-write control. The September certification evidence proves PR #279 bypassed Repository Manager because its head did not match the deterministic `adt/codex/<task-id>` contract. The prior executor combined full-access execution, persistent Codex identity, and GitHub-capable egress; available evidence does not safely identify which user credential or connected-account channel authenticated that PR.

Revision 12 restores the established split container-boundary execution semantics after revision 11 incorrectly required native Bubblewrap sandboxing. Roll Repository Manager, Executor, and Controller to the same immutable Runner image. `protocolVersion` remains unchanged because the external Runner protocol did not change.
