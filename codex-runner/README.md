# ADT Codex Runner

The ADT Codex Runner is an independently deployed, shared-secret-protected bridge to the pinned Codex App Server. It provides bounded Codex execution for ADT Agent Workflows.

The packaged Codex binary is an experimental GNU/glibc build. It is neither release-equivalent nor an OpenAI-published GNU prebuilt artifact.

`release.json` is the canonical source for the packaged Codex version, protocol version, and Runner revision. Build and protocol implementation details remain authoritative in source, tests, and publication workflows.

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

- ChatGPT/Codex authentication belongs to the Runner and persists under `CODEX_HOME`.
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

- Equal supported revisions are current.
- An older installed revision may show an update available.
- A newer Runner may remain compatible with an older ADT deployment.
- Unsupported protocol or required capability remains fail-closed.

Image rollout timing, Docker/Portainer configuration, mounts, persistent storage, and service lifecycle remain operator-owned.
