# GitHub artifact deployment

Production uses the GitHub backend and the dedicated private repository. Configure these exact settings:

```text
ARTIFACT_REPOSITORY=github
GITHUB_APP_ID
GITHUB_APP_CLIENT_ID
GITHUB_APP_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY
GITHUB_TOKEN_ENCRYPTION_KEY
GITHUB_ARTIFACT_REPOSITORY_OWNER=zailghe3
GITHUB_ARTIFACT_REPOSITORY_NAME=fpo-artifacts
SESSION_SECRET
```

## Catalogue KV cache

Production also requires a dedicated Workers KV namespace bound as `ARTIFACT_CATALOGUE_CACHE`; authentication D1 is never used for artifact bodies. Create it manually with `npx wrangler kv namespace create ARTIFACT_CATALOGUE_CACHE` (or in the Cloudflare dashboard), then add the returned production namespace `id` to the matching `kv_namespaces` entry in `wrangler.jsonc` in the deployment configuration. The repository intentionally contains no fabricated production ID. This is a manual prerequisite; do not deploy until the binding resolves. A separate preview namespace may be configured with `preview_id` when remote preview testing is wanted.

The cache defaults to 300 seconds. `ARTIFACT_CATALOGUE_FRESHNESS_SECONDS` can override it and is clamped to 30–3600 seconds. Keys are versioned and scoped to repository ID, owner/name, branch, and artifact root. Immutable revision-keyed chunks (about 1.5 MB maximum, split only at artifact boundaries) hold validated artifacts and their file SHAs; a small current pointer is published only after every chunk write succeeds. Cloudflare KV is eventually consistent, so another isolate may briefly observe the prior complete pointer. Both versions remain safe and refresh work is single-flight within an isolate.

Direct-write invalidation first advances a repository generation marker and then removes the pointer. Generation comparison protects refreshes within one isolate, but Workers KV is eventually consistent and is not a globally atomic compare-and-swap lock. Publication therefore performs a lightweight GitHub base-revision check immediately before and after writing the pointer; repository verification errors retain their repository category and are never reported as KV failures. Each pointer carries a private publication-attempt identifier, so an uncertain KV write cannot mistake its own unverified pointer for an independent competing publisher. A changed or temporarily unverifiable final base advances generation, marks the isolate dirty, and best-effort removes the attempted pointer unless a fully validated, demonstrably newer independent publication is visible. Cleanup propagation remains eventual rather than atomic. Another location may still briefly observe a prior complete snapshot while KV changes propagate. Orphaned immutable chunks are harmless. Cache reads and writes that fail do not turn healthy GitHub reads or successful GitHub writes into failures: fresh GitHub content is returned as `degraded`, safe stable events are logged, and the UI distinguishes cache degradation from stale GitHub content. Concurrent isolates may idempotently write the same deterministic revision chunks; contention counts as a competing publication only when the complete validated pointer has a different attempt identifier, the intended generation, and equal-or-newer refresh time. Manual refresh precedence is ordinary read, forced revision check, then full rebuild, with stronger work queued rather than downgraded.

Authorized fresh reads avoid GitHub downloads. Stale reads check only the base ref; an unchanged revision republishes freshness metadata without loading blobs. A stale last-known-good snapshot is served only for network, 429, or 5xx failures and is visibly marked. Access, configuration, not-found, encoding, path, duplicate-ID, and content failures fail closed. Malformed KV values are logged without bodies and treated as misses.

The library's **Refresh** control forces a base revision check; **Full rebuild** redownloads and validates the catalogue for corruption recovery. Successful direct creates, updates, and draft variations remove only the current pointer so the next authorized read rebuilds; immutable history remains. Proposal branches and pull requests do not invalidate the base catalogue. A merged proposal is discovered after freshness expiry or manual refresh. Operational recovery is: verify GitHub availability and binding identity, use Full rebuild, and only then delete corrupt namespace values if necessary. No webhook, cache-key browser API, resource provisioning, or automatic deployment is included.

Local `ARTIFACT_REPOSITORY=file` development never requires KV and does not render cache refresh controls; the protected refresh handler returns a safe unsupported response if called. Current Wrangler deploys can [automatically provision resources whose IDs are omitted](https://developers.cloudflare.com/workers/wrangler/configuration/#provision-resources). The production workflow therefore runs `node scripts/validate-production-bindings.mjs` before building or deploying and refuses an omitted/empty KV `id`. This PR is **not production-deployable and must not close DATA-003** until an operator has provisioned the real namespace and committed its public production namespace ID to `kv_namespaces`. Codex does not provision that resource.

The branch and artifact root remain optional and default to `main` and `artifacts`. The GitHub App callback URL is exactly `https://fpo-adt.florian-pouchet.workers.dev/auth/github/callback`. Give the App **Contents: read and write**, **Pull requests: read and write**, and **Metadata: read-only** permissions, then install it with selected-repository access to `zailghe3/fpo-artifacts`. Upgrading an existing App from read-only Contents access requires an organisation or repository administrator to approve the new installation permissions; GitHub may leave the installation pending until that approval is complete. Make this change and obtain approval manually before deploying write or proposal features—the application does not modify the App configuration.

Wrangler declares all six sensitive/identity settings as required Worker secrets. Set each through the Cloudflare dashboard or, while authenticated to the correct account, with `npx wrangler secret put NAME`. Generate independent values for token encryption and session signing:

```bash
openssl rand -base64 32 # GITHUB_TOKEN_ENCRYPTION_KEY
openssl rand -base64 48 # SESSION_SECRET
```

GitHub-downloaded PKCS#1 (`BEGIN RSA PRIVATE KEY`) keys and PKCS#8 (`BEGIN PRIVATE KEY`) keys are both supported. Encrypted keys, public keys, and certificates are not. Never commit `.env`, `.dev.vars`, PEM keys, secret values, OAuth tokens, or session data.

Reads use short-lived installation tokens restricted to the configured immutable repository ID and `Contents: read`. Direct writes receive separately memoized `Contents: write` tokens. Proposal branches, Git Data commits, and pull requests receive separately memoized tokens with `Contents: write` and `Pull requests: write`. Metadata remains read-only at the App installation. No static repository token is supported, and installation tokens are not stored in D1. Authorization is rechecked after seven minutes. The deployment runs Wrangler's required-secret validation and then a smoke test which checks only that OAuth initiation returns a GitHub authorization redirect with state and S256 PKCE; it does not log in to GitHub.

Direct artifact creates and updates use the same repository-restricted installation token and GitHub Contents API. A `403` from a write is surfaced as the safe `write_permission_required` API category; operators should verify both the App permission and installation approval. The application never changes App permissions, creates branches, or deploys automatically as part of a write.
