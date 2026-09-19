# ADT Codex Runner

ADT Codex Runner is the independently deployed execution boundary for model-directed Codex work in Artifact Dev Toolkit. It exposes a bounded ADT-facing API while keeping Codex identity, arbitrary command execution, and trusted Git publication in separate roles.

`release.json` is the canonical source for protocol compatibility, Runner revision, and the packaged Codex version. Source, tests, image configuration, and publication workflows remain authoritative for exact protocol fields, limits, timeouts, and release mechanics.

The packaged Codex binary is an experimental GNU/glibc build and is neither release-equivalent nor an OpenAI-published GNU prebuilt artifact.

## Reference security model

Split mode is the reference production/security architecture. The same image supports four roles through `CODEX_RUNNER_ROLE`:

- **`controller`** — owns the public `/v1` API, ADT Runner secret, environment catalogue, durable job/idempotency state, emergency-stop state, optional hard-restart webhook, and internal request-signing authority. It does not execute model-generated commands or mount Codex/workspace state.
- **`executor`** — owns Codex authentication, `CODEX_HOME`, local Codex SQLite state, and model-directed command execution inside the constrained container. It has no ADT Runner secret, controller signing key, Repository Manager private state, GitHub credential, or infrastructure restart credential.
- **`repository-manager`** — owns trusted managed-repository mirrors, Git control state, task publication state, and credentialed Git transport. It never executes model-generated commands and does not mount Codex identity/state.
- **`integrated`** — compatibility deployment that keeps the older single-container execution model where native Codex sandboxing is available. New split-security design should not depend on this mode.

The split topology therefore has two distinct privileged paths:

```text
ADT -> Controller -> Executor            model-directed execution
ADT -> Controller -> Repository Manager trusted Git operations
```

The Controller signs private internal requests. Executor and Repository Manager receive verifier material only, so compromise of either role cannot mint Controller requests.

`docker-stack.split.example.yml` is the reference deployment topology. It keeps Controller, Executor, Repository Manager, and the two egress proxies on narrowly shared networks; only the proxies join the external uplink.

## Executor boundary

In split mode, the **executor container is the Codex execution security boundary**.

- An admitted `workspace-write` environment may be mapped to Codex full access inside that container. This is container-local authority, not host authority.
- Split execution must not depend on Bubblewrap or another native Codex sandbox inside the container.
- `read-only` environments fail closed in split mode rather than silently weakening their contract.
- Do not use privileged mode, add `SYS_ADMIN`, mount the Docker socket, or otherwise replace the intended container boundary with host authority.
- The reference stack uses a read-only root filesystem, dropped capabilities, bounded writable mounts, and a non-root runtime user.
- Runner-owned Codex/App Server overrides disable login shells, web search, MCP/apps/remote-control surfaces, broad environment inheritance, and system Git credential discovery for model-directed commands.
- Only a small environment allowlist and validated proxy configuration are restored to model-directed shell execution; secret-, token-, key-, password-, credential-, and auth-like variables remain excluded.

Codex authentication and installation identity are intentionally inside the Executor trust boundary. Because model-directed execution has full access inside the constrained split container, Executor-visible Codex identity material is not protected by an inner filesystem sandbox. The security objective is instead to keep ADT, GitHub, Controller-signing, Repository Manager, and infrastructure credentials outside that boundary.

## Network and egress boundaries

The split stack separates Executor egress from Repository Manager egress.

- Executor has no direct uplink and uses a dedicated fail-closed Squid policy restricted to the required Codex/OpenAI model and authentication destinations.
- Repository Manager uses a separate proxy and network. The current proxy blocks private/reserved destinations but permits public HTTP(S); trusted Repository Manager code independently constrains managed Git remotes to the configured GitHub repository. The proxy is therefore not itself a GitHub-domain allowlist.
- Executor and Repository Manager do not join each other's egress overlays.
- Neither role joins the external uplink directly, so removing proxy variables does not create a direct Internet route.
- Proxy access logging is disabled to avoid intentionally recording URLs, queries, or credentials.

Repository Manager is the only Runner role that combines trusted Git authority with a path to GitHub. Executor has neither GitHub credentials nor a GitHub-capable publication path.

Exact proxy ACLs, image pins, network names, and smoke-test mechanics are authoritative in `squid*.conf`, `docker-stack.split.example.yml`, and CI.

## Emergency stop and uncertain execution

The Controller owns the persistent emergency-stop latch.

- Emergency stop rejects new admission before attempting interruption/recovery of active work.
- A configured hard-restart webhook is best-effort infrastructure recovery; failure never clears the latch or reports success.
- Safe resume requires the recovery conditions enforced by the current Controller/Executor generation contract.
- Normal cancellation remains cooperative, but uncertain side-effecting Codex work is never recreated merely because observation failed.
- Executor replacement makes prior-generation execution terminal rather than replaying it.

The Runner has no Docker API access; Docker/Portainer remains the source of truth for service lifecycle and resource monitoring.

## Environment contracts

### Ordinary workspaces

An ordinary Runner environment is an operator-provisioned private workspace.

- ADT references only its safe public key and supported public options; it never supplies an arbitrary private path.
- A workspace may be a normal directory or Git checkout.
- Persistent workspace changes remain until the operator resets them.
- Git tooling is an execution aid only. Ordinary jobs do not automatically clone, reset, pull, branch, commit, push, or create pull requests.
- GitHub credentials are not supplied to ordinary Executor jobs.
- Workspace provisioning and reset policy remain operator responsibilities.

### Managed repository environments

A managed environment adds trusted repository configuration to a `workspace-write` environment.

- Repository identity and base branch come from operator-controlled environment configuration rather than from the model.
- Repository Manager owns mirrors, Git control directories, durable task records, sealed commits, and publication state in storage the Executor cannot mount.
- Executor sees only the current managed task workspace, not trusted Git control state or remote authority.
- New tasks start from the currently configured base; continuation may use only an already validated managed association.
- Unexpected existing content, unsafe path boundaries, identity drift, or repository-state corruption fail closed rather than being adopted as authority.

A representative configuration is:

```json
{
  "schemaVersion": 1,
  "environments": [
    {
      "key": "project",
      "name": "Project",
      "cwd": "/workspaces/project",
      "enabled": true,
      "sandbox": "workspace-write",
      "repository": {
        "managed": true,
        "owner": "example-owner",
        "repo": "example-repository",
        "baseBranch": "main"
      }
    }
  ]
}
```

For ordinary environments omit `repository`. Exact schema validation and path rules are authoritative in source/tests.

## Authentication and readiness

- ChatGPT/Codex authentication belongs to Executor and persists in `CODEX_HOME`; ADT never stores that credential.
- Connection reachability, protocol compatibility, Codex authentication, environment readiness, model discovery, execution-boundary readiness, Repository Manager readiness, and job readiness are distinct conditions.
- Controller revalidates environment readiness against the live Executor; managed environments additionally require Repository Manager readiness.
- **Test Codex** performs a bounded authenticated model-turn health check and is separate from normal Workflow execution.
- Health and diagnostics expose bounded safe status only and must not return prompts, model output, reasoning, credentials, private paths, arbitrary protocol payloads, or unsafe upstream errors.
- Certificate/hostname verification and container security controls must not be weakened for troubleshooting.

## Persistent job state and idempotency

Controller state is durable and operator-managed.

- Job identity and idempotency state become durable before side-effecting execution can proceed.
- Matching replays resolve to the same accepted job; conflicting replays do not execute.
- The current Runner admits at most one Workflow Codex job at a time and is not a general waiting queue.
- Temporary polling/observation failure does not recreate an accepted job.
- Runner/Executor restart does not silently resubmit prior active Codex work.
- Cancellation targets the existing accepted job.
- If side-effecting turn start or interruption cannot be reconciled safely, ambiguity remains explicit and capacity is not reused as though quiescence were proven.

Exact state-file representation, limits, timeout values, and protocol fields remain implementation details.

## Managed Git publication

Managed publication deliberately separates model-directed editing from credentialed repository mutation.

- ADT supplies short-lived repository authority for the exact managed operation through the trusted Controller/Repository Manager path.
- Repository credentials are not part of the durable Runner job fingerprint or task record, are not written to remotes/config/logs/API results, and never enter Executor.
- Repository Manager derives the Git target from trusted managed-environment configuration and durable task context rather than Executor-visible Git metadata.
- Git commands disable hooks, ambient credential helpers, system configuration, terminal prompting, and unsafe external protocols. Credentials are exposed only to the bounded Git subprocess through the image-owned askpass helper.
- Publication stages only the trusted managed task result, skips empty new-task publication, and uses non-force updates.
- The explicit **Publish GitHub PR** Workflow block is the only normal Workflow operation that may request managed publication.
- Publication may create or update the one validated ADT-managed draft or ready pull request associated with the task. It does not merge pull requests, force-push, adopt arbitrary repositories/remotes/branches, or allow model-authenticated pushes.
- Continuation may use only the previously validated managed pull-request association.
- Ambiguous push/publication outcomes are reconciliation-only: they must not create a second branch, push, or pull request merely because the first result was uncertain.

The GitHub App must have the repository permissions required by the selected managed operation. ADT mints short-lived repository-scoped credentials per operation rather than provisioning a long-lived GitHub secret to Runner.

## SQLite storage, backup, and recovery

Current Codex uses live SQLite state that must remain on local filesystem storage, separate from durable non-SQLite Codex home state.

- Keep `CODEX_HOME` on durable storage for authentication/configuration, sessions, installation identity, and completed ADT backup sets.
- Mount `CODEX_SQLITE_HOME` on a writable local Docker volume or block filesystem. Do not place live SQLite on NFS/NFS4/CIFS/SMB.
- Executor alone mounts both locations.
- On initial separation, the Runner can migrate quiescent legacy SQLite data from `CODEX_HOME` into the empty local SQLite home without deleting the durable source.
- Backups use SQLite-consistent online backup into staging, verify completed databases, and store cold backup sets under durable Codex home storage.
- The status interface can create backups and perform confirmed SQLite-only restore.
- Restore refuses active work, confirms App Server shutdown before mutating live SQLite, validates the backup, keeps a pre-restore safety copy, verifies readiness, and rolls back on failure where safe.
- If shutdown or rollback cannot be confirmed, execution remains fail-closed for operator recovery.

The reference split stack keeps Executor and Repository Manager co-located when their shared task workspace uses node-local Docker storage. Operators remain responsible for node placement, durable backup storage, and recovery after node loss.

Exact backup intervals, retention, backup IDs, filesystem detection, staging mechanics, and UI/API fields remain authoritative in source/tests and the stack example.

## Diagnostics

Operational diagnostics may report bounded classifications for:

- Runner/App Server readiness and packaged release consistency;
- DNS/TCP/TLS/CA/proxy readiness;
- Codex-home and local SQLite-storage readiness;
- workspace and managed-repository readiness;
- execution-boundary availability;
- safe job/control/storage state.

Diagnostics are advisory and must not expose credentials, addresses where not intended, response bodies, arbitrary headers, certificates, raw socket/App Server errors, prompts, model output, reasoning, filenames, remotes, or private filesystem paths.

Successful Codex authentication does not prove workspace, execution-boundary, repository, or publication readiness; those conditions remain separate.

## CI and publication

CI is impact-selected rather than one fixed Runner pipeline.

- Pull-request verification may independently select Runner tests, Runner image build/smoke, and proxy-policy smoke according to the central change-impact classifier.
- PR-built images are verification artifacts only and are never promoted to production.
- Trusted `main` publication retests the exact merged Runner source, rebuilds the image from that immutable commit, smoke-tests that exact image, then publishes the immutable source-SHA tag and `latest`.
- Publication refuses to overwrite an existing immutable SHA tag.
- CI may build/publish Runner images but does not deploy, restart, or reconfigure the operator-owned Runner stack.

## Release compatibility

`release.json` defines:

- `protocolVersion` — external Runner wire-compatibility generation;
- `runnerRevision` — Runner implementation generation;
- `codexVersion` — packaged Codex version.

ADT and Runner Git commits do not need to match. Compatibility is determined by protocol and required capabilities; revision differences provide rollout/freshness information.

`release.json` is also a shared application/Runner production input because ADT embeds the expected Runner release. When it changes, the Worker carrying the new expectation must deploy successfully before publication of the corresponding Runner image. Exact ordering is enforced by the trusted main lifecycle.

All split roles should run the same immutable Runner image revision. Squid/proxy configuration has its own deployment lifecycle and does not require rebuilding an unchanged Runner image.

Image rollout timing, Docker/Portainer configuration, mounts, storage, proxy rollout, and service lifecycle remain operator-owned.
