# ADT Codex Runner

This repository-owned, server-to-server HTTP bridge runs Codex on the home cluster; OpenAI still hosts model inference. Codex App Server is a private stdio child used only for account lifecycle. Future job execution will use the official Codex SDK through `CodexJobRunner`; it is deliberately unavailable today.

## Deployment

Deploy `poulti/adt-codex-runner:latest` with the Compose example. Create the external `codex_runner_shared_secret` in Docker/Portainer, never in YAML. `CODEX_RUNNER_SHARED_SECRET_FILE` is preferred; supplying it together with the development-only direct environment variable fails closed. Only a single trailing newline is removed.

Mount durable storage at `CODEX_HOME=/data/codex`. Images and containers are disposable, while that volume retains ChatGPT authentication. Never copy the volume into an image or repository. Pull and recreate manually or with Shepherd; GitHub Actions only publishes images and never operates the cluster.

Place an independently managed Cloudflare Tunnel named `adt-codex-runner` in front of the service: hostname `cr.pouchet.net`, origin `http://<home-runner-service>:8789`, Access application policy `Service Auth`, and the ADT service token as the sole identity. Access and `X-Codex-Runner-Secret` are both required for `/v1/**`. Do not expose App Server, add browser CORS, or commit Tunnel credentials.

The production Compose topology joins `cloudflared` and `codex-runner` to the private `codex_ingress` network and publishes no host port. If `cloudflared` instead runs directly on the host, add only a loopback binding: `ports: ["127.0.0.1:8789:8789"]`. Never publish the Runner on every host/LAN interface.

## Updating the pinned Codex protocol

The Dockerfile intentionally pins the verified `@openai/codex@0.118.0` version. Its generated v2 App Server schema supports `account/login/start` with `{type:"chatgptDeviceCode"}` and returns `loginId`, `verificationUrl`, and `userCode`. The image build generates the installed CLI's schema and fails unless that complete contract is present; only an image that passed that check sets the marker used to advertise `deviceAuth`. CI repeats the deterministic check without beginning a real ChatGPT login.

To upgrade the pin: update the exact version; generate and inspect the old and new initialization/account contracts; update this client and protocol fixtures if required; run Runner tests and the schema validator; run the real App Server `/v1/auth/status` image smoke test with an empty `CODEX_HOME`; then build the Docker image. The stdio device-request test, schema validation, and real CLI smoke make drift visible without committing a large generated schema. Device login remains an explicit user ceremony; normal tests and image validation never authenticate with OpenAI.

Runner protocol 1 reports capabilities so independently deployed ADT and Runner releases can coexist. There is no GitHub credential, repository clone/mutation, or coding execution authority in this release.
