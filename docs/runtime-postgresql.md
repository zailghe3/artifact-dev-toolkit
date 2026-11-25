# PostgreSQL operations for ADT Runtime

The PostgreSQL cutover started Runtime with empty operational tables. Pre-cutover run history, approvals, tool journals, pending Advisor knowledge proposals, MCP attestations, settings, registrations and credential records remain in the restricted D1 backup. Git stores definitions, artifacts and published Advisor knowledge. The Codex Runner retains its own jobs, identity and storage.

## Prepare the stack

1. Choose a stack for the deployment. Use the Runtime-only stack below when PostgreSQL already exists. Use the [standalone Swarm stack](../adt-runtime/docker-stack.example.yml) for a new database.
2. Configure `GITHUB_APP_ID` and `GITHUB_APP_CLIENT_ID` as ordinary Worker variables. Wrangler preserves operator-managed variables. Copy the existing values before replacing either secret binding and verify sign-in after the change.
3. Mount the existing `adt_runtime_auth` value and the three Codex Runner service credentials listed below. Set the Worker and Runner URLs. Copy the delegated GitHub logins into Runtime's `ADT_TOOL_APPROVERS`, `ADT_TOOL_OPERATORS` and `ADT_TOOL_POLICY_ADMINS`. Keep the Worker policy-admin configuration consistent for authoring checks.

### Existing PostgreSQL service

Use [the Runtime-only Swarm/Portainer stack](../adt-runtime/docker-stack.existing-postgres.example.yml) with the existing `adt-runtime-postgres:5432` service, database and user `adt_runtime`, and Swarm secret `ADT_Runtime_Postgres_Password`. Preserve the running PostgreSQL replica and its NFS data directory. The Runtime-only stack mounts only the separate Runtime key export.

- Use the existing private PostgreSQL overlay for the stack's external `database` network. Confirm the PostgreSQL service advertises `adt-runtime-postgres` on that overlay and permits the Runtime role to connect from it. Attach Runtime to the ingress and database overlays. Keep PostgreSQL off the ingress network and leave port 5432 unpublished.
- Provision the separate Runtime key export for UID/GID 1000 with mode `0700`. Set ownership at the NFS server when root squashing is enabled. Use a synchronous export and hard mount, and verify atomic hard links and directory sync.
- The Runtime role needs `CONNECT` and `CREATE` on the database for first-time schema creation. It needs ownership of its `adt_runtime` schema and its objects for future migrations. If the existing role has cluster-wide privileges, create a dedicated login role with no superuser, role-creation, database-creation or replication privileges. In the `adt_runtime` database, grant that role `CONNECT` and `CREATE`, then use its name and Swarm password-file secret in the Runtime stack. For an initialized installation, arrange ownership of the existing schema and objects with the database administrator before changing roles. Keep the matching vault root file. A role change requires no fresh data directory.
- Deploy from `adt-runtime/` with `docker stack deploy -c docker-stack.existing-postgres.example.yml adt-runtime`, or supply the same stack to Portainer. Pin the published Runtime image by Git SHA. Keep PostgreSQL managed by its existing stack. If both services share one stack, update the Runtime service while keeping PostgreSQL in the stack definition.

### New PostgreSQL service

The standalone stack provisions one private PostgreSQL replica. Create `adt_postgres_bootstrap_password` and `adt_postgres_app_password` as separate Swarm secrets. Bootstrap provisions a non-superuser application role. Use distinct NFS exports for PostgreSQL and Runtime keys. Provision `pgdata` for UID 70 with mode `0700`, and use POSIX locking, hard mounts and durable `fsync`. Label exactly one node `adt-postgres=true`. Fence the old node and confirm its PostgreSQL process stopped before moving the label or mounting its files on another node.

## Deploy and verify

- Main lifecycle automatically deploys eligible Worker changes after verification. Use **Manual Cloudflare deployment** with an exact merged commit SHA for operator recovery. The workflow applies D1 migrations and deploys the Worker from that commit.
- Runtime health and signed readiness require a working PostgreSQL connection and an initialized operational schema. Compare infrastructure readiness with **Test execution path** in Diagnostics after deploying the Runtime stack.
- Verify GitHub sign-in, Git-backed definitions and artifact reads, Codex Runner status, an Advisor run that uses a native tool, and an approval that resumes after restarting Runtime. Check that new history and decisions survive the restart.

## Verify Workflow management and Runner diagnostics

1. In Diagnostics, confirm the expected Runtime release and signed infrastructure readiness. Run **Test execution path** and expand **Management request details**. A recovered path has HTTP 200, accepted authentication and protocol, a persisted replay nonce, a dispatched command, and available PostgreSQL, checkpoint, and repository-scoped Workflow history reads. The optional GitHub broker has its own status.
2. In the same authenticated session, open `/api/workflow-runs?limit=1` and confirm HTTP 200 with a `runs` array. Open **Workflows** and **Workflow runs** and confirm the history or a successful empty state.
3. For a failed probe, copy the technical report. Match its correlation ID to `worker_runtime_management_request` in Worker logs and `runtime_management_request` in Runtime logs. Compare the stage, result, status, and dispatch evidence. A Worker-only observation leaves Runtime arrival unverified. The execution-path endpoint returns the `adt.runtime-management.v1` diagnostic schema.
4. In the Codex Runner section, gather **Auth/environment diagnostics** when the App Server is unavailable. Compare the startup category, elapsed time, and optional exit code or signal with the passive capabilities and Executor observations.

## Recover from a deployment issue

- For rollback, pause new launches, drain or recover new runs, and keep the PostgreSQL data and key pair. Restore the recorded Worker and Runtime revisions together with their matching configuration. Audit external side effects before retrying work on either deployment.
- Preserve the restricted pre-cutover D1 export, its matching vault and OAuth encryption keys, the recorded Worker revision, Runtime image SHA and Swarm configuration for the rollback retention window. To back up the current D1 binding, run `npx wrangler d1 export AUTH_SESSIONS_DB --remote --output adt-sessions.sql`.
- Recover credentials through ADT if definitions still reference the old vault. Re-enter provider API keys and Adrian credentials, reconnect Work IQ, and have a policy administrator review and re-authorize recovered authenticated MCP contracts. Restore Advisor settings and Codex environment registrations as needed.

## Retire operational tables in D1

Run this separate operation after the cutover checks succeed and the rollback retention window ends. Keep the protected pre-cutover export and record the verified Runtime and Worker revisions. Export D1 again before cleanup if you need a recovery point for newly created sessions.

1. From the repository root, inspect the deployed binding with the command below. Compare the result with the expected table and index names in the [retirement SQL](../scripts/maintenance/retire-d1-operational-state.sql). Resolve any unexpected objects or missing objects before proceeding.
2. Run the reviewed file through Wrangler's D1 import and check that the command reports completion. The import guard checks the exact table and named-index inventory, excluding Cloudflare metadata and Wrangler's migration ledger. Divergence aborts the import before the first drop. Each table drop removes its associated indexes and live records.
3. Repeat the inventory query. Expect `auth_sessions` and its two named indexes, `d1_migrations`, and Cloudflare internal objects visible to the query. Confirm `provider_credential_vault`, `workflow_runs`, and each other listed operational table and index are absent. Sign in and repeat a catalogue read. The KV catalogue cache is a separate binding.

```sh
npx wrangler d1 execute AUTH_SESSIONS_DB --remote --command "SELECT type, name, tbl_name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name"
npx wrangler d1 execute AUTH_SESSIONS_DB --remote --file scripts/maintenance/retire-d1-operational-state.sql
npx wrangler d1 execute AUTH_SESSIONS_DB --remote --command "SELECT type, name, tbl_name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name"
```

## Runtime keys and backups

- Runtime generates its 32-byte vault root and an RSA wrapping key in the persistent key directory. Private files are mode `0600`. A PostgreSQL advisory lock serializes migrations and pins the vault root fingerprint. A missing, invalid or mismatched root blocks startup. Runtime provides the wrapping public key through authenticated readiness.
- Vault encryption keys derive from the root, repository identity and key version. With Runtime stopped, the database owner can increment `active_key_version` in the singleton `adt_runtime.installation` row. On restart, Runtime uses the new version for new and replaced credentials. Earlier ciphertext remains readable with its recorded version. Rotate individual credentials through ADT and keep the root paired with its database. Replacing the root is a separate data-reset operation.
- Back up the schema with `pg_dump --format=custom --schema=adt_runtime --file=adt-runtime.dump adt_runtime` from the private database network. For the standalone example, use database `adt`. Store a corresponding encrypted copy of the key directory separately. Record the pair under one backup ID.
- Restore to an empty database as the Runtime role with `pg_restore --exit-on-error --no-owner --no-privileges --dbname=adt_restore adt-runtime.dump`. Restore the matching keys and their ownership and modes. Verify the restored pair and authenticated readiness on an isolated network before switching production traffic.
- Run `npm --prefix adt-runtime run build` and `adt-runtime/scripts/test-postgres.sh` for a disposable PostgreSQL integration test.

## Secret inventory

| Value | Owner and purpose |
| --- | --- |
| `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_SECRET` | Worker retains GitHub App signing and OAuth authority. |
| `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID` | Public GitHub identity settings, entered as ordinary Worker variables. |
| `SESSION_SECRET` | Worker root for browser session and GitHub OAuth encryption keys. |
| `ADT_RUNTIME_AUTH_SECRET` and `adt_runtime_auth` | Shared Worker and Runtime request authentication. |
| `ADT_Runtime_Postgres_Password` | Runtime password-file secret for the existing PostgreSQL service. |
| `adt_postgres_bootstrap_password`, `adt_postgres_app_password` | PostgreSQL bootstrap and application credentials for the standalone stack. |
| `adt_runner_access_client_id`, `adt_runner_access_client_secret`, `adt_runner_shared_secret` | Runtime's connection to Codex Runner. Runner retains its own service credentials. |
| Runtime key directory | Runtime-generated vault root and RSA wrapping key. Persist and back up both files. |
| Optional Runtime and split Runner redeploy webhooks | Runtime-only maintenance secrets. See [Runtime operations](../adt-runtime/README.md). |

After cutover verification and the rollback retention window:

- Delete obsolete Worker secrets `GITHUB_TOKEN_ENCRYPTION_KEY`, `WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY` and `ADT_INTERNAL_AUTHORITY_SECRET`. Keep the archived old keys for as long as you retain a recoverable pre-cutover backup.
- Delete Worker secrets `CODEX_RUNNER_ACCESS_CLIENT_ID`, `CODEX_RUNNER_ACCESS_CLIENT_SECRET` and `CODEX_RUNNER_SHARED_SECRET` after verifying that the Runtime service uses its corresponding Swarm secrets and can reach Codex Runner.
- Delete obsolete Worker variables `ADT_RUNTIME_WRAPPING_PUBLIC_KEY`, `ADT_TOOL_GATEWAY_URL`, `ADT_CHECKPOINT_GATEWAY_URL`, `ADT_GRAPH_NODE_GATEWAY_URL` and `CODEX_RUNNER_BASE_URL` where present. Keep the D1 session binding, KV catalogue cache, and configured Work IQ OAuth redirect URI.
- Remove retired Runtime environment variables `ADT_RUNTIME_PRIVATE_KEY` and `ADT_RUNTIME_PRIVATE_KEY_FILE`. Remove the old mount and then delete the unused Swarm secret `adt_runtime_private_key`. Keep the new Runtime key export and current database, service and Runner credentials.
