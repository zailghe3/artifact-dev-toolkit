# ADT Codex Runner

This repository-owned, server-to-server HTTP bridge runs Codex on the home cluster; OpenAI still hosts model inference. Codex App Server is a private stdio child used only for account lifecycle. Future job execution will use the official Codex SDK through `CodexJobRunner`; it is deliberately unavailable today.

## Deployment

Deploy `poulti/adt-codex-runner:latest` with the Compose example. Create the external `codex_runner_shared_secret` in Docker/Portainer, never in YAML. `CODEX_RUNNER_SHARED_SECRET_FILE` is preferred; supplying it together with the development-only direct environment variable fails closed. Only a single trailing newline is removed.

Mount durable storage at `CODEX_HOME=/data/codex`. Images and containers are disposable, while that volume retains ChatGPT authentication. Never copy the volume into an image or repository. Pull and recreate manually or with Shepherd; GitHub Actions only publishes images and never operates the cluster.

Place an independently managed Cloudflare Tunnel named `adt-codex-runner` in front of the service: hostname `cr.pouchet.net`, origin `http://<home-runner-service>:8789`, Access application policy `Service Auth`, and the ADT service token as the sole identity. Access and `X-Codex-Runner-Secret` are both required for `/v1/**`. Do not expose App Server, add browser CORS, or commit Tunnel credentials.

The production Compose topology joins `cloudflared` and `codex-runner` to the private `codex_ingress` network and publishes no host port. If `cloudflared` instead runs directly on the host, add only a loopback binding: `ports: ["127.0.0.1:8789:8789"]`. Never publish the Runner on every host/LAN interface.

Device-code authentication also requires the `codex` subprocess to resolve and establish outbound TCP/TLS connections to `auth.openai.com:443`. Cloudflare Tunnel connectivity into the Runner does not prove this outbound path works. In particular, a Docker network marked `internal` blocks ordinary Internet egress unless another explicit egress path exists. Proxy-controlled environments may require the appropriate HTTP/HTTPS proxy variables. Networks that intercept TLS may require a trusted PEM bundle selected with `CODEX_CA_CERTIFICATE`, or the `SSL_CERT_FILE` fallback; neither is required by the normal deployment and no organisation-specific CA is embedded in the image. Proxy values, credentials, CA paths, and CA contents must never be logged.

The shared-secret-protected `GET /v1/diagnostics/auth-environment` endpoint performs only bounded, non-mutating checks against the fixed authentication host. It reports ordered system resolution (never addresses), the container IPv6-disable bit, separate IPv4/IPv6 TCP and verified-TLS results with allowlisted failure classes, the strictly parsed active Codex version, and `HEAD` results for `/` and `/api/accounts/deviceauth/usercode`. The device route is checked with HTTP/1.1, HTTP/2, no User-Agent (matching the inspected 0.118 login request), and a truthful `ADT-Codex-Runner-Diagnostic/<runner version>` User-Agent. Results contain only bounded status, challenge, redirect, content-kind, exact Cloudflare-edge, and optional three-letter colo metadata; bodies, locations, arbitrary headers, command output, stderr, addresses, paths, and credentials never leave the Runner. Diagnostics never start or poll device authentication and do not solve or bypass Cloudflare challenges.

The complete connection chain is: Browser -> ADT -> Cloudflare Worker -> Cloudflare Access -> Cloudflare Tunnel -> Node Runner -> `codex app-server` -> Codex Rust/reqwest client -> DNS/address selection -> TCP -> TLS -> the Cloudflare `auth.openai.com` edge -> device-auth API. A working inbound tunnel therefore does not prove outbound Codex connectivity, and a working Node probe does not guarantee identical Rust/reqwest behavior. Likewise, `ipv6Available=true` means DNS advertised an AAAA record, not that IPv6 is usable.

Codex tag `rust-v0.118.0` (commit `b630ce9a4e754d35a1f33e4366ba638d18626142`) was inspected before enabling the mitigation. Its workspace feature graph does not enable `reqwest/hickory-dns`; the login code builds the ordinary reqwest client and adds no User-Agent to the device-code request. Reqwest consequently uses the system resolver, so glibc `/etc/gai.conf` can affect selection. The Runner image installs the complete default glibc precedence table with IPv4-mapped destinations raised above generic IPv6 and exposes the Runner-owned `CODEX_RUNNER_ADDRESS_POLICY=ipv4_preferred` marker only after build-time validation. This keeps IPv6 and AAAA answers enabled and is reversed by deploying an older image. Node resolver ordering verifies that the policy is visible to the system resolver; it does not prove what a particular Codex request selected.

The operator-level `disable_ipv6` sysctl is neither required nor recommended by this image and did not fix the observed production case. A `cf-mitigated: challenge` response is an upstream Cloudflare mitigation response, not an ADT authorization failure.

## Updating the pinned Codex protocol

The Dockerfile intentionally pins the verified `@openai/codex@0.118.0` version. Its generated v2 App Server schema supports `account/login/start` with `{type:"chatgptDeviceCode"}` and returns `loginId`, `verificationUrl`, and `userCode`. The image build generates the installed CLI's schema and fails unless that complete contract is present; only an image that passed that check sets the marker used to advertise `deviceAuth`. CI repeats the deterministic check without beginning a real ChatGPT login.

To upgrade the pin: update the exact version; generate and inspect the old and new initialization/account contracts; update this client and protocol fixtures if required; run Runner tests and the schema validator; run the real App Server `/v1/auth/status` image smoke test with an empty `CODEX_HOME`; then build the Docker image. The stdio device-request test, schema validation, and real CLI smoke make drift visible without committing a large generated schema. Device login remains an explicit user ceremony; normal tests and image validation never authenticate with OpenAI.

Runner protocol 1 reports capabilities so independently deployed ADT and Runner releases can coexist. There is no GitHub credential, repository clone/mutation, or coding execution authority in this release.

## Safe device-start diagnostics

Failed device starts keep the stable `device_auth_start_failed` operation code and may include only an allowlisted reason: login disabled, device login not enabled, upstream forbidden, rate limited, unavailable, rejected, transport failure, CA configuration, HTTP-client configuration, internal, or unknown. A strictly parsed HTTP status and finite integer JSON-RPC code may accompany that reason. Raw App Server errors, error data, stderr, response bodies, credentials, codes, and private paths are always discarded.
