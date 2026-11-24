# PostgreSQL for ADT Runtime

Advisor settings and Codex environment registrations use Runtime's PostgreSQL management API. The Worker verifies the browser session and repository access, then signs the Runtime request. PostgreSQL keeps each repository's records separate. Git remains authoritative for definitions, artifacts and published Advisor knowledge.

Workflow scheduling, approvals, execution history, knowledge proposals, credentials and MCP policy still use the current Cloudflare execution path. The PostgreSQL schema and store tests exercise these data models in isolation. Keep the current Worker, D1 bindings, Workflow binding and execution secrets for these features.

## Operator deployment

1. Export D1 before this release with `npx wrangler d1 export AUTH_SESSIONS_DB --remote --output adt-d1-before-postgres.sql`. Store the export with restricted access and record the current Worker and Runtime revisions. For a future execution cutover, stop or drain Workflow launches before the final export so the backup reflects settled operations.
2. Provision distinct NFS exports for PostgreSQL and Runtime keys. Substitute their paths and server address in [the Swarm stack](../adt-runtime/docker-stack.example.yml). PostgreSQL's files must support POSIX ownership, locking, atomic operations and durable `fsync`. Use hard client mounts and synchronous server exports. Provision `pgdata` for the image's PostgreSQL user (UID 70 for the pinned Alpine image), with mode `0700`. Provision the key directory for Runtime's Node user (UID 1000), also with mode `0700`. Set ownership at the NFS server when root squashing is enabled. Runtime atomically publishes its key with a hard link and syncs the containing directory. Verify both operations on the actual key export.
3. Label exactly one Swarm node `adt-postgres=true`. The database runs privately with a single replica and stop-first updates and rollbacks. Before moving the label or mounting the data export on a replacement node, fence the old node and verify that the old PostgreSQL process has stopped. A network partition can leave the old process running.
4. Create the external Swarm secrets `adt_postgres_bootstrap_password` and `adt_postgres_app_password` with distinct generated passwords. The bootstrap account creates a dedicated non-superuser role. Runtime uses the app password and creates its own schema. Keep both values in the operator's secret store outside the repository.
5. Deploy the stack from `adt-runtime/` using `docker stack deploy -c docker-stack.example.yml adt-runtime`, or use the equivalent Portainer stack. PostgreSQL initializes the dedicated database and role during its first startup. Swarm can start services together. Runtime exits on a failed database connection or initialization, and Swarm retries it. Check PostgreSQL health, Runtime health and authenticated Runtime readiness before deploying the Worker. Existing Runtime-only deployments without database configuration continue to serve execution requests, while the new settings routes require PostgreSQL.
6. Deploy the Worker and re-enter Advisor settings and Codex environment registrations. This release starts these two stores empty. Use repositories and Git-backed definitions already configured for the application.
7. Read the settings again after a Runtime restart. Check that an Advisor question can launch using the saved settings and that the Codex registration API returns the expected values. Caller-supplied Codex `Idempotency-Key` values allow exact mutation replays after a lost response. Use the same key and body for a retry.

## Runtime key and backups

- On first initialization, Runtime generates a 32-byte root key and stores it in a `0600` file owned by UID 1000 on the dedicated key export. A database advisory lock serializes migrations and records the installation fingerprint. Subsequent startups verify the same file and database fingerprint. A missing, invalid or mismatched key blocks startup. Persist and back up this file independently of the application container.
- The repository-scoped PostgreSQL vault uses authenticated encryption and keys derived by repository and version. The PostgreSQL integration test verifies replacement under a new key version and resolution of existing ciphertext. Application credential management still uses the existing D1 vault. Live root rotation for the PostgreSQL vault remains pending. Protect the Runtime host and the key backups.
- Use an authenticated PostgreSQL backup account on the private network. Create a custom-format dump with `pg_dump --format=custom --schema=adt_runtime --file=adt-runtime.dump adt`. Copy the corresponding Runtime root-key file to a separate encrypted backup destination. Track the pair by backup ID.
- Restore into an empty database and restore the schema as the Runtime database role with `pg_restore --exit-on-error --no-owner --no-privileges --dbname=adt_restore adt-runtime.dump`. Restore the matching key to a private directory with its ownership and modes intact. Start a test Runtime against the restored pair and verify readiness and settings. Keep the recovery network separate from production.
- Run `npm --prefix adt-runtime run build` and `adt-runtime/scripts/test-postgres.sh` to exercise PostgreSQL initialization, scoped writes, a database reconnect, dump and restore, and recovery with the original key. The script uses a disposable local Docker container.

## Secret inventory for this release

| Value | Location and purpose |
| --- | --- |
| `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_SECRET` | Cloudflare retains the external GitHub App and OAuth credentials. |
| `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID` | Current Cloudflare GitHub identity configuration. Deployment still expects both values. |
| `SESSION_SECRET`, `GITHUB_TOKEN_ENCRYPTION_KEY` | Cloudflare retains session signing and GitHub OAuth token encryption. |
| `ADT_RUNTIME_AUTH_SECRET` and `adt_runtime_auth` | Shared Worker and Runtime service authentication, including the new settings API. |
| `ADT_INTERNAL_AUTHORITY_SECRET` | Cloudflare retains current Workflow gateway and tool callback authority. |
| `ADT_RUNTIME_WRAPPING_PUBLIC_KEY`, `ADT_RUNTIME_PRIVATE_KEY` and `adt_runtime_private_key` | Existing public configuration and private Runtime input for execution and credential transport. |
| `WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY` | Cloudflare retains the active D1 credential-vault key. |
| `CODEX_RUNNER_ACCESS_CLIENT_ID`, `CODEX_RUNNER_ACCESS_CLIENT_SECRET`, `CODEX_RUNNER_SHARED_SECRET` | Cloudflare retains access to the independently deployed Codex Runner. |
| `ADT_Runtime_Redeploy_Webhook` and the three `Codex_Runner_*_Redeploy_Webhook` secrets | Optional Runtime maintenance settings. See [Runtime operations](../adt-runtime/README.md). |
| `adt_postgres_bootstrap_password`, `adt_postgres_app_password` | New bootstrap and application database credentials in Swarm. |
| Runtime root-key file | Generated and persisted by Runtime. Provision its restricted directory and back up the file. |

Keep the listed existing secrets through this release. The production D1 and Workflow dependencies must be removed and verified before their secrets can be retired. Cloudflare, Portainer and Swarm deployment are operator actions. The repository changes themselves provision no services, rewrite no GitHub artifacts and export no production data.
