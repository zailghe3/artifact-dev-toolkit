# ADT Codex Runner

The Runner uses an experimental GNU/glibc build that is neither release-equivalent nor an OpenAI-published GNU prebuilt artifact. It is a private, shared-secret-protected bridge to the pinned Codex App Server. It uses **Codex CLI 0.147.0** from source commit `be6e8eac029b183056b7e4402879f15d2c85f61b`; workflow jobs use only the bounded interface documented below.

## Authentication and connection readiness

ChatGPT device-code authentication works through `account/login/start` and persists in `CODEX_HOME`. Debian `ca-certificates` and `libssl3` are required runtime dependencies. The image validates the canonical `/etc/ssl/certs/ca-certificates.crt` bundle and never weakens certificate or hostname verification.

“Connected” confirms the App Server's `account/read` authentication state. The explicitly clicked **Test Codex** action additionally proves that one authenticated model turn completes. `POST /v1/codex/test` accepts no prompt or request body and returns only `{ "ok": true, "durationMs": 1840 }` or `{ "ok": false, "reason": "<bounded-enum>" }`. It remains a health check, distinct from general workflow jobs. `/v1/capabilities` reports `jobExecution: true` because this binary implements the version 1 jobs protocol; configured workspace readiness remains separate.

The test creates a new empty `/tmp/adt-codex-test-*` directory and sends Codex 0.147 `thread/start` with `cwd`, `ephemeral: true`, `approvalPolicy: "never"`, and `sandbox: "read-only"`, without a model override. It sends exactly one `turn/start` text input containing a server-generated cryptographic nonce. It consumes the matching `item/completed` agent message and `turn/completed` notification. Any side-effect item or approval request fails closed and triggers `turn/interrupt`; the absolute Runner deadline is 52 seconds, including setup and cleanup; two seconds are reserved for best-effort interruption and temporary-directory cleanup, with no retry. This guarantees the bounded Runner response by 52 seconds, leaving eight seconds of margin inside ADT's 60-second transport timeout. The directory is always removed. Nonces, prompts, output, reasoning, account data, and thread/turn IDs never cross the HTTP boundary or logs.

## Operational authentication diagnostics

`GET /v1/diagnostics/auth-environment` retains bounded operational checks for Runner/App Server readiness, exact Codex version, native libc and address policy, ordered resolver family, kernel IPv6 state, IPv4/IPv6 DNS/TCP/verified TLS, the system and optional custom CA configuration, proxy presence, and Codex-home access. A single non-mutating `HEAD /api/accounts/deviceauth/usercode` check reports whether the exact route returned an HTTP response; HTTP 405 means the route is reachable.

Diagnostics do not POST, request a device code, send `client_id`, read response bodies, or run transport A/B experiments. Logs contain only bounded environment classifications and no addresses, URLs, certificates, headers, bodies, raw errors, credentials, or Codex protocol output.

The glibc build and `/etc/gai.conf` IPv4-preferred resolver policy remain intentional because production advertises IPv6 while its IPv6 path is unavailable.

## CI and publication

Pull requests and generic main verification run source validation, root tests/lint/typecheck/builds, and Runner tests/typecheck. They do not build the final Runner Docker image. On trusted `main`, **Publish Codex Runner** is the single owner of the expensive final image build and offline smoke. It tests exact merged source, builds, checks the image (including CA packages/bundle, GNU/glibc Codex, address policy, schemas, startup, health, capabilities, and disconnected state), and only then authenticates to Docker Hub and pushes immutable SHA and `latest` tags. A build or smoke failure occurs before login/push, leaving the previously published image available.

The smoke test never performs live OpenAI authentication or model inference. Persistent BuildKit caching is not configured; cold builds remain authoritative and reproducible.

## Workflow environments and persistent jobs

Workflow execution uses Runner-owned local environments. Set
`CODEX_RUNNER_ENVIRONMENTS_FILE=/run/config/codex-environments.json` and mount a
strict version 1 document read-only:

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

Keys use ADT definition-id syntax and are limited to 80 characters; names are
limited to 120. `cwd` must be an existing absolute directory. The only sandbox
values are `read-only` and `workspace-write`; workflow approval policy is always
`never`. The path is private to the Runner and is never part of its public API.
An absent environment file is valid and produces an empty catalog.

Set `CODEX_RUNNER_STATE_DIR=/data/runner` and mount `/data` persistently with
ownership for the non-root container user. Job records are mode 0600 and are
atomically renamed into a mode 0700 directory. Active jobs found after restart
become terminal `runner_restarted` failures and are never submitted again. The
v1 implementation globally serializes jobs, which is stricter than one active
job per environment.

For Docker/Portainer, mount an operator-selected repository directory at (for
example) `/workspaces/fpo-artifacts`, mount the JSON configuration at
`/run/config/codex-environments.json:ro`, and configure both variables above.
Ensure the container user can read the mount and, for `workspace-write`, create
and remove files there. Do not use world-writable permissions.

The public environment descriptor contains only `key`, `name`, `enabled`,
`ready`, and the finite `sandbox` classification. Model discovery retains only
`id`, `displayName`, `isDefault`, `defaultReasoningEffort`, and the ordered
`reasoningEffort`/`description` entries returned by Codex 0.147.0.

The catalog `id` is the stable selection token stored by ADT. The Runner keeps
Codex's separate canonical `model` field private and, when an explicit model is
selected, sends that canonical value as `thread/start.model`. With Codex default
selected, the `model` member is omitted. A configured reasoning effort is sent
as the exact 0.147.0 `turn/start.effort` field.

Workflow job requests accept at most 1,970,000 HTTP bytes and at most 524,320
UTF-8 prompt bytes. This covers the existing 65,536-character master prompt plus
the 262,144-byte workflow input, including four-byte Unicode and worst-case JSON
control-character escaping, while auth and diagnostic routes retain their 16 KiB
control-plane limit. The limits are fixed by the Runner and are not Agent options.
Production job duration defaults to 7,000,000 ms, may be reduced by the operator
with `CODEX_RUNNER_JOB_DURATION_MS`, and cannot exceed that hard maximum.

Cancellation and timeout share one deferred-interrupt lifecycle. Intent is
remembered before protocol IDs exist; when the matching thread and turn IDs
arrive, the Runner interrupts exactly once. A cancellation received before
execution starts prevents the Codex turn entirely. The global lease is retained
until the underlying turn quiesces. If timeout interruption does not quiesce
within the 30-second cleanup deadline, workflow execution is marked unhealthy,
no later job is admitted, and an operator must restart the Runner/App Server;
the lease is never released while the old turn may still write.

A job's opaque ID, idempotency digest, fingerprint, and queued provisional state
are durably recorded before account/model validation. Digest lookup can therefore
reconcile a lost start response while validation is still pending. Validation
then moves that same job to execution or a bounded terminal failure; it never
deletes the idempotency evidence or submits a second turn.
