# ADT security hardening

Review date 28 November 2026. The implementation reviewed in PR #406 is `5ac66db55e3f084df293acb20336018a7742fddd`, based on `dbc49c0887539596a88d7d594604ef8604d85d81` in `zailghe3/artifact-dev-toolkit`. It replaces executable front matter, validates MCP URLs, strengthens browser mutations and authentication, and limits sensitive response caching and logging. This follow-up records the evidence and operator decisions.

## Dependency evidence

The advisory inventory lists every high or critical occurrence from the retained source and image scans by advisory, package and version. Matching package records are grouped by evidence source. Fixed versions are for the affected release line when the feed lists one. Build-only libraries and inspected published images have separate scope entries. Confirmed absence requires evidence from packaging, the binary or a defined service path. Unassessed paths remain open even if authentication, role isolation or egress limits reduce exposure. [Advisory inventory](security-hardening-advisories.csv)

- Both npm audit scopes returned zero advisories for each of the root, Runtime and Runner lockfiles. Trivy 0.76.2 used its 28 November 2026 database and the severity selected by its feeds. OSV-Scanner 2.7.1 extracted manifests, but its batch API returned HTTP 403. [Trivy severity selection](https://trivy.dev/docs/v0.76/guide/scanner/vulnerability/#severity-selection)
- The Go source scan used the vendored Adrian modules in this PR. `govulncheck` 1.10.0 used Go advisory data at `d8a8b1ad05e834fdd40b66c80c618ec7a557ba53`. Source call analysis could not load the pinned SQLite dependency. The stripped published executable returned module matches. Inspection of 18,059 compiled function names found PBKDF2 and no `x/crypto/ssh` functions or package markers. The WebSocket module match GO-2026-6278 involves client framing, and the reviewed Adrian integration uses it as a server. The fixed client version is `v1.5.4-0.20240701034025-d67f41855da4`. [Go vulnerability database](https://github.com/golang/vulndb) [WebSocket advisory](https://pkg.go.dev/vuln/GO-2026-6278)
- The Cargo scan used `openai/codex` tag `rust-v0.172.0` at `3d86e43b075adeba2193ec5c22ac92f55afd82e6`. The lockfile includes optional and build dependencies. It establishes resolved versions, with compiled feature reachability still unassessed. The published Runner records ADT revision `e2bc17cf79689412aa79f343f586695536d74c6b`. Registry digests establish the images inspected. The operator's live image digests, host kernel and unpublished CI image layers were outside the scan. [Codex release](https://github.com/openai/codex/releases/tag/rust-v0.172.0)

### Inspected images

The evidence names in the CSV map to these Linux amd64 images. Counts include repeat findings across binary packages or images.

| Evidence | Registry image and manifest digest | Critical / high |
| --- | --- | ---: |
| Runtime Alpine base | `node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5` | 0 / 6 |
| Published Runtime | `poulti/adt-runtime@sha256:cbef12afe390f49e8cf8907c769a157eb1f99cefe38bcc809bc036d53ca2f333` | 0 / 6 |
| Runner Bookworm base | `node:26.13.1-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9` | 1 / 44 |
| Published Runner | `poulti/adt-codex-runner@sha256:7e893c531be24580386169d0e2447b9ea1fa0108f8ea4a4892a9f9002817b9c1` | 3 / 129 |
| Adrian Distroless base | `gcr.io/distroless/static-debian12@sha256:d75cdd72874d4790092fcb1b058493ecf6bb5bf2b2b897045b00ff01d91843f2` | 0 / 0 |
| Published Adrian | `poulti/adrian-backend@sha256:16a12e2fb8e8c8730f5b359c5354419c100a63809ba6a73b2821f627cf0c7af4` | 0 / 10 |
| Pinned Squid | `ubuntu/squid@sha256:d9c34c5ab74c6dd41cf1070d9b4221aac072e67e983527ca2d41512958f77506` | 0 / 0 |
| Pinned PostgreSQL | `postgres:17.12-alpine@sha256:f9cf3e1f0066f0eb0c48707d864f0ac5941e9ff454a072077d97a4d278d07d73` | 1 / 32 |
| Adrian Go builder | `golang:1.27.4-bookworm@sha256:ce59b41415e2524ae99926fe1f37ce48ba8c194dcbd2a56a65436cdcefa2bd34` | 4 / 248 |
| Codex Rust builder | `rust:1.99.1-bookworm@sha256:e6f2cff35d0f309acf8433b4f05878ed77092602c5065cc81801177da0bb3a9c` | 21 / 657 |

The Go manifest had 10 high and the Cargo lockfile had four high. Earlier comparisons used Squid digests `sha256:8a3baed477e2c282ab8aa5edad442f69873246964f225c5c2ae8364b6610963c` and `sha256:6a097f68bae708cedbabd6188d68c7e2e7a38cedd05a176e1cc0ba29e3bbe029`, and PostgreSQL 17.11 at `sha256:e5d2edd28b1f8d40a0a6c0c9cdc545b19b56a0d5d88f94bc11a97d970d4700d0`. The inventory covers the residual results after the pin changes.

### Disposition

- Prioritise the next compatible Codex release that includes `gix` 0.90.0 or later. Gitoxide is used for workspace operations. The vulnerable configuration path in the built CLI remains unassessed. Managed Executor admission excludes Git metadata, and the separate Repository Manager holds scoped Git credentials and uses the system Git CLI. Check self-managed workspaces when validating the update. [Gitoxide advisory](https://github.com/advisories/GHSA-q54r-jf2p-rfr2) [Release pin](../codex-runner/Dockerfile)
- Runner uses Git and libcurl for managed HTTPS transport. The managed sequence does not invoke recursive submodule clone, merge or fast-import. The affected SQLite operation requires control of SQL or data used by affected extensions. The service issues fixed local backup commands and exposes no SQL endpoint. Debian does not ship the affected MiniZip code in `zlib1g`. Other shared-library call paths are unassessed. Take compatible Bookworm backports as available and reassess when enabling new processing paths. [Git recursive-clone advisory](https://security-tracker.debian.org/tracker/CVE-2026-111760) [SQLite advisory](https://security-tracker.debian.org/tracker/CVE-2025-7458) [Debian MiniZip assessment](https://security-tracker.debian.org/tracker/CVE-2023-45853)
- npm-bundled Undici and brace expansion findings concern tooling in the image. The deployed services start Node directly. Runtime fetch uses Node's Undici 8.12.4 and the MCP client uses 8.13.1. Executor npm use remains subject to the sandbox and egress rules. Pick up the compatible parent-image refresh. [Node security releases](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases/)
- PostgreSQL's `gosu` 1.20 uses Go 1.24.6 and executes as a local privilege-drop helper. Its startup path has no TLS service or query input, including the TLS condition for CVE-2025-68121. The image contains `libxml2` 2.13.9-r2. The affected `xmlcatalog` executable is absent. ADT's reviewed SQL does not call XML processing. Other database clients remain unassessed. Follow the official image refresh for Go and Alpine fixes. [Gosu source](https://github.com/tianon/gosu/blob/1.20/main.go) [Alpine security database](https://secdb.alpinelinux.org/v3.24/main.json)

The remaining candidates either lack a compatible fix for the inspected release line or lack evidence of significant exposure in ADT's normal service paths. Keep the existing dependency pins and track the specific updates above. Builder advisories apply to image supply-chain risk. The Dockerfiles copy the built Codex package or Adrian binary from those stages into separate runtime images.

## Image changes

### Squid

Set the image on both `codex-runner-executor-egress-proxy` and `codex-runner-egress-proxy` to the following line. Preserve both role networks, proxy ACLs and capability drops. [Compose definition](../codex-runner/docker-stack.split.example.yml)

```yaml
image: ubuntu/squid:6.6-24.04_edge@sha256:d9c34c5ab74c6dd41cf1070d9b4221aac072e67e983527ca2d41512958f77506
```

The pinned container reports Ubuntu 24.04.5 LTS (Noble), Squid 6.14, and `dpkg-query -W squid squid-common` reports `6.14-0ubuntu0.24.04.5` for both packages. The digest contains the exact fixed Noble package for CVE-2026-61642 in USN-8941-1. The related FTP fix CVE-2026-47729 is included. Caching is disabled and the proxies expose no public ports. A client on the respective proxy network can still reach its request parser, which warrants the package update. [Ubuntu USN-8941-1](https://ubuntu.com/security/notices/USN-8941-1) [Ubuntu FTP advisory](https://ubuntu.com/security/CVE-2026-47729)

The pin had zero Trivy high or critical findings. Squid's moderate CVE-2026-104786 requires forwarding Basic credentials through a configured cache peer. Neither proxy configures one. Ubuntu defers the medium-priority CVE-2026-62846 and has not published enough detail to assess its reachability. Track future Noble backports. Verify permitted model and Git traffic, private destination blocking, and role isolation during rollout. [Squid peer advisory](https://github.com/squid-cache/squid/security/advisories/GHSA-j9pf-q9f6-v44c) [Ubuntu deferred advisory](https://ubuntu.com/security/CVE-2026-62846)

### PostgreSQL

The exact standalone image runs Alpine 3.24.4 and `postgres --version` reports 17.12 from the image's PostgreSQL installation in `/usr/local/bin`. The PostgreSQL project lists 17.12 fixes for composite type handling (CVE-2026-6460 and CVE-2026-116306), view visibility (CVE-2026-16237), COPY diagnostics (CVE-2026-116310) and backup handling (CVE-2026-116314), among others. ADT uses a private database, a restricted service role and application-issued SQL. The same-major update addresses the database and operator utility fixes. Back up PostgreSQL and its paired Runtime key directory, check extension compatibility, then verify Runtime readiness and restore. [Compose definition](../adt-runtime/docker-stack.example.yml) [PostgreSQL 17.12 release notes](https://www.postgresql.org/docs/17/release-17-12.html) [PostgreSQL advisory list](https://www.postgresql.org/support/security/)

```yaml
image: postgres:17.12-alpine@sha256:f9cf3e1f0066f0eb0c48707d864f0ac5941e9ff454a072077d97a4d278d07d73
```

## Cloudflare operator procedure

### Retire the alternate Worker hostname

This PR retains the current `workers.dev` route because the live Runtime configuration and signed broker traffic could not be verified. Both Runtime Compose examples and the production OAuth start smoke use `https://adt.pouchet.net`. The compiled Worker smoke uses a local origin. The tracked source and deployment workflows contain no remaining operational reference to a `workers.dev` hostname.

1. Inspect the active Runtime deployment configuration and confirm `ADT_RUNTIME_WORKER_URL=https://adt.pouchet.net` after the operator's normal rollout. Check manually managed consumers, monitors, bookmarks and the registered GitHub OAuth callback as well. Keep the old route available until the replacement is verified.
2. In the authenticated ADT UI, run **Connections → ADT Runtime → Test execution path** for the configured repository. Require a successful scoped GitHub broker result. This diagnostic verifies signed Runtime-to-Worker credential exchange without starting a provider. Confirm the request used the custom domain and record only status and approval evidence. [Runtime commissioning procedure](../adt-runtime/README.md)
3. After the first two checks pass, commit the following top-level entries to `wrangler.jsonc` and use the normal authorised Worker deployment. This makes the setting durable across Wrangler deployments. [Cloudflare routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/#disabling-workersdev-in-the-wrangler-configuration-file) [Version URL settings](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
4. Check the deployed Worker settings for both disabled URL options and verify the former production and version URLs are unavailable. Retest the custom-domain OAuth start, browser sign-in and signed broker diagnostic. Repeat these checks after a subsequent normal deployment to confirm the source configuration prevents reactivation. If a caller needs the old hostname to recover, use a reviewed configuration rollback and repeat the cutover checks before retrying.

```json
{
  "workers_dev": false,
  "preview_urls": false
}
```

### Rate limits

Scope the rules to `http.host eq "adt.pouchet.net"` with the exact methods and paths below. Use a per-source-IP counter, block with HTTP 429 for 60 seconds, and adjust to the closest period and mitigation timeout available on the plan. Observe legitimate volumes first using staging or log-only mode where supported. [Cloudflare rate limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)

| Match | Initial limit per IP |
| --- | ---: |
| `GET /auth/github/start` | 15 per 60 seconds |
| `GET /auth/github/callback` | 30 per 60 seconds |
| `GET /sign-in` | 60 per 60 seconds |
| `GET` on `/api/artifacts`, `/api/conversations` or `/api/workflow-runs`, increment on HTTP 401 if response counting is available | 60 failures per 60 seconds |
| `POST /api/runtime-repository-credential` with a missing or unexpected `x-adt-protocol` header, if header matching is available | 30 per 60 seconds |

Count invalid session attempts on these protected API paths without inspecting or retaining cookie values. Response counting allows the first failed requests through and limits subsequent traffic. If the plan cannot count response status, use a conservative total limit only on selected API paths after measuring normal traffic. Keep assets and normal signed service traffic outside these low ceilings. The broker protocol header is an edge filter. The Worker still validates the signature and replay state. Use narrow exact paths and operator-verified egress if a separate broker limit is needed. Avoid interactive challenges for OAuth callbacks and signed services.

In staging, verify a normal OAuth round trip and successful signed broker diagnostic. Exercise each limit with synthetic requests at the configured threshold, confirm a 429 after the threshold and recovery after the timeout, and check the security events for the matched path. Verify authenticated API traffic and the deployment OAuth smoke remain functional. Tune from denies and legitimate peaks before rollout.

### Cloudflare Access

| Direction | Current authentication | Prerequisite for Access enforcement |
| --- | --- | --- |
| Runtime → Codex Runner | Both Cloudflare Access service-token headers and the Runner application shared secret are supported. | Retain the existing service-token and shared-secret configuration. [Runner client](../lib/codex-runner-client.ts) |
| Worker → Runtime, including broker replay claim | ADT signed requests. The client has no Access service-token layer. | Implement server-only Access token headers on all Runtime client paths before enforcing Access at the Runtime hostname. [Runtime client](../lib/adt-runtime-client.ts) [Control client](../lib/runtime-service-client.ts) |
| Runtime → Worker repository broker | Separate ADT signed and replay-checked request to the Worker. | Implement a dedicated Runtime-to-Worker Access token for this path. Retain the existing signed authority. [Broker client](../lib/runtime-service-client.ts) [Broker route](../app/api/runtime-repository-credential/route.ts) |

- **Runtime hostname.** Provision a dedicated Access service token for the Worker, store the credentials as server-side secrets, and retain ADT request signing. Inventory every caller, including execution, control, readiness, broker replay claim and operational diagnostics. Use a workload-specific Service Auth policy in staging and validate the token and application signature independently. Verify local container health checks and any external monitors through their intended routes before enforcement.
- **Main Worker hostname.** Retire alternate routes first. Use an MFA-capable identity provider and an explicit one-user Allow policy for the browser. Preserve GitHub OAuth, app sessions and repository authorisation, keeping OAuth start and callback under the same browser Access policy. Use a more specific Service Auth application for the repository broker with a dedicated Runtime token. Inventory any other machine callbacks and deployment checks that use the public address, including the OAuth-start smoke. Give necessary machine callers supported token paths or owned internal routing before enforcement. Verify desktop and mobile sign-in, service requests with both authorisations, and denied requests missing either layer.
- Stage the policies independently. Record service-token ownership, expiry and rollback before enforcement. A rollback can remove Access enforcement and revert its caller configuration while keeping ADT authentication active. Access implementation is an operator follow-up. [Self-hosted Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) [Path precedence](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) [Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)

### Verify observability and retained logs

1. Confirm the deployed version uses the committed `observability.redact_query_string: true` and `observability.logs.invocation_logs: false`. Review Workers Logs settings and any Logpush, trace, tail or external collection configuration independently.
2. In staging, send synthetic OAuth query markers and dummy authorization, cookie and service header values through a denied authentication path. Also exercise a staging operation with a known safe application event and confirm that it appears in each enabled sink. Search the same window for the synthetic markers and for invocation events with `$cloudflare.$metadata.type = "cf-worker-event"`. Confirm query strings are absent from recorded request URLs, invocation events are disabled and safe custom events remain available.
3. Review retained pre-change logs in place for callback URLs containing code or state parameters and for authentication fields in request metadata. Check every enabled sink over its retention window. Record affected time ranges and counts without copying values. A confirmed exposure belongs in the existing incident process. [Workers Logs configuration](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) [Wrangler observability](https://developers.cloudflare.com/workers/wrangler/configuration/#observability)

## Secret scanning and verification

Gitleaks 8.30.1 ran with full redaction over the tracked files and available Git history of both `zailghe3/artifact-dev-toolkit` and `zailghe3/fpo-artifacts`. The artifact repository checkout was `5dd91561f8f1f7a14077a36a9811f71f61b8f886` with 89 available commits. ADT history and the tracked-tree scan found three synthetic fixtures. The artifact repository flagged one current and two historical vault-reference matches. The browser bundle had zero flags, and the private Worker bundle's 15 matches resolved to generated framework values and a code match. No confirmed deployment credential was identified. The private repository had no tracked MCP definitions in the available history. Live retained logs require the operator verification above.

- Local implementation verification passed 1,384 application tests, 213 Runtime tests and 263 Runner tests, plus OpenNext build, compiled Worker security smoke, authenticated UI streaming, Wrangler dry run, Workflow and Advisor integration, PostgreSQL integration, proxy isolation and compatibility for 18 private artifacts.
- The earlier local Runtime image build ran out of disk space. GitHub CI subsequently completed the canonical Runtime build and image smoke, Runner build and image smoke, proxy-policy smoke, compiled Worker security smoke and PostgreSQL integration on the reviewed implementation commit. The PR checks track the follow-up head. [Reviewed implementation run](https://github.com/zailghe3/artifact-dev-toolkit/actions/runs/46143096895) [PR checks](https://github.com/zailghe3/artifact-dev-toolkit/pull/406/checks)
