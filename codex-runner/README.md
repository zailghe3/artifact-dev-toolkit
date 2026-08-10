# ADT Codex Runner

This repository-owned, server-to-server HTTP bridge runs Codex on the home cluster; OpenAI still hosts model inference. Codex App Server is a private stdio child used only for account lifecycle. Future job execution will use the official Codex SDK through `CodexJobRunner`; it is deliberately unavailable today.

## Deployment

Deploy `poulti/adt-codex-runner:latest` with the Compose example. Create the external `codex_runner_shared_secret` in Docker/Portainer, never in YAML. `CODEX_RUNNER_SHARED_SECRET_FILE` is preferred; supplying it together with the development-only direct environment variable fails closed. Only a single trailing newline is removed.

Mount durable storage at `CODEX_HOME=/data/codex`. Images and containers are disposable, while that volume retains ChatGPT authentication. Never copy the volume into an image or repository. Pull and recreate manually or with Shepherd; GitHub Actions only publishes images and never operates the cluster.

Place an independently managed Cloudflare Tunnel named `adt-codex-runner` in front of the service: hostname `codex-runner.pouchet.net`, origin `http://<home-runner-service>:8789`, Access application policy `Service Auth`, and the ADT service token as the sole identity. Access and `X-Codex-Runner-Secret` are both required for `/v1/**`. Do not expose App Server, add browser CORS, or commit Tunnel credentials.

Runner protocol 1 reports capabilities so independently deployed ADT and Runner releases can coexist. There is no GitHub credential, repository clone/mutation, or coding execution authority in this release.
