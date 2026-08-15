# ADT Codex Runner

The Runner uses an experimental GNU/glibc build that is neither release-equivalent nor an OpenAI-published GNU prebuilt artifact. It is a private, shared-secret-protected bridge to the pinned Codex App Server. It uses **Codex CLI 0.147.0** from source commit `be6e8eac029b183056b7e4402879f15d2c85f61b`; this PR does not add general Codex jobs or Agents.

## Authentication and connection readiness

ChatGPT device-code authentication works through `account/login/start` and persists in `CODEX_HOME`. Debian `ca-certificates` and `libssl3` are required runtime dependencies. The image validates the canonical `/etc/ssl/certs/ca-certificates.crt` bundle and never weakens certificate or hostname verification.

“Connected” confirms the App Server's `account/read` authentication state. The explicitly clicked **Test Codex** action additionally proves that one authenticated model turn completes. `POST /v1/codex/test` accepts no prompt or request body and returns only `{ "ok": true, "durationMs": 1840 }` or `{ "ok": false, "reason": "<bounded-enum>" }`. It is a health check, **not general job execution**; `/v1/capabilities` continues to report `jobExecution: false`.

The test creates a new empty `/tmp/adt-codex-test-*` directory and sends Codex 0.147 `thread/start` with `cwd`, `ephemeral: true`, `approvalPolicy: "never"`, and `sandbox: "read-only"`, without a model override. It sends exactly one `turn/start` text input containing a server-generated cryptographic nonce. It consumes the matching `item/completed` agent message and `turn/completed` notification. Any side-effect item or approval request fails closed and triggers `turn/interrupt`; the absolute Runner deadline is 52 seconds, including setup and cleanup; two seconds are reserved for best-effort interruption and temporary-directory cleanup, with no retry. This guarantees the bounded Runner response by 52 seconds, leaving eight seconds of margin inside ADT's 60-second transport timeout. The directory is always removed. Nonces, prompts, output, reasoning, account data, and thread/turn IDs never cross the HTTP boundary or logs.

## Operational authentication diagnostics

`GET /v1/diagnostics/auth-environment` retains bounded operational checks for Runner/App Server readiness, exact Codex version, native libc and address policy, ordered resolver family, kernel IPv6 state, IPv4/IPv6 DNS/TCP/verified TLS, the system and optional custom CA configuration, proxy presence, and Codex-home access. A single non-mutating `HEAD /api/accounts/deviceauth/usercode` check reports whether the exact route returned an HTTP response; HTTP 405 means the route is reachable.

Diagnostics do not POST, request a device code, send `client_id`, read response bodies, or run transport A/B experiments. Logs contain only bounded environment classifications and no addresses, URLs, certificates, headers, bodies, raw errors, credentials, or Codex protocol output.

The glibc build and `/etc/gai.conf` IPv4-preferred resolver policy remain intentional because production advertises IPv6 while its IPv6 path is unavailable.

## CI and publication

Pull requests and generic main verification run source validation, root tests/lint/typecheck/builds, and Runner tests/typecheck. They do not build the final Runner Docker image. On trusted `main`, **Publish Codex Runner** is the single owner of the expensive final image build and offline smoke. It tests exact merged source, builds, checks the image (including CA packages/bundle, GNU/glibc Codex, address policy, schemas, startup, health, capabilities, and disconnected state), and only then authenticates to Docker Hub and pushes immutable SHA and `latest` tags. A build or smoke failure occurs before login/push, leaving the previously published image available.

The smoke test never performs live OpenAI authentication or model inference. Persistent BuildKit caching is not configured; cold builds remain authoritative and reproducible.
