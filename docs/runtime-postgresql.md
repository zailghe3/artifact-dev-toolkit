# PostgreSQL cutover for ADT Runtime

This is a clean cutover. Runtime starts with empty operational tables. Old run history, approvals, tool journals, pending Advisor knowledge proposals, MCP attestations, settings, registrations and credential records remain in the restricted D1 backup. ADT has no import or replay step. Git-backed definitions, artifacts and published Advisor knowledge stay in Git. The Codex Runner retains its own jobs, identity and storage.

## Prepare the stack

1. Before merging, confirm a maintenance window and keep the GitHub Actions repository variable `ADT_POSTGRES_CUTOVER_READY` unset. The first merge may publish the verified Runtime image while automatic Worker deployment is paused. Keep Runtime auto-updaters paused and pin the running image until the drain.
2. Provision separate NFS exports for PostgreSQL and Runtime keys. Fill in the NFS server, paths and ingress network in [the Swarm stack](../adt-runtime/docker-stack.example.yml) and pin the published Runtime image by Git SHA. PostgreSQL needs POSIX ownership, locking, atomic operations and durable `fsync`. Use hard client mounts and synchronous server exports. Provision `pgdata` for UID 70 and the key directory for UID 1000, both mode `0700`. Set ownership at the NFS server where root squashing is enabled. Verify atomic hard links and directory sync on the key export.
3. Label exactly one Swarm node `adt-postgres=true`. PostgreSQL runs on a private overlay with one replica and stop-first updates and rollbacks. Fence the old host and confirm its PostgreSQL process has stopped before moving the label or mounting the data export on a replacement host.
4. Create `adt_postgres_bootstrap_password` and `adt_postgres_app_password` as external Swarm secrets with distinct generated passwords. The bootstrap account provisions a separate non-superuser role. Runtime uses the application password and manages its own schema.
5. Configure the public GitHub App ID and OAuth client ID as ordinary Worker variables `GITHUB_APP_ID` and `GITHUB_APP_CLIENT_ID`. Wrangler preserves operator-managed variables. Copy the existing values before replacing either secret binding, and verify sign-in before retiring the old configuration.
6. Mount the existing `adt_runtime_auth` value and the three Codex Runner service credentials listed below. Set the Worker and Runner URLs. Copy the delegated GitHub logins into Runtime's `ADT_TOOL_APPROVERS`, `ADT_TOOL_OPERATORS` and `ADT_TOOL_POLICY_ADMINS`. Keep the Worker policy-admin configuration consistent for authoring checks.

## Drain and deploy

1. Pause browser access and automation that can launch runs or submit updates. Drain or cancel every old Workflow, including paused approvals. Check Cloudflare Workflow instance status and reconcile ambiguous provider, tool, Runner or GitHub activity. A new Runtime will only see launches made after the cutover.
2. Export D1 with `npx wrangler d1 export AUTH_SESSIONS_DB --remote --output adt-d1-before-postgres.sql`. Restrict access to the export and securely archive the matching old vault and OAuth encryption keys. Record the Worker deployment, Runtime image SHA and old Swarm inputs for rollback.
3. Deploy the new Runtime stack with `docker stack deploy -c docker-stack.example.yml adt-runtime` from `adt-runtime/`, or use the equivalent Portainer stack. Swarm starts both services and retries Runtime if PostgreSQL is still starting. Check PostgreSQL health, Runtime health and signed readiness before changing the Worker.
4. Run the **Manual Cloudflare deployment** workflow against the exact merged cutover SHA. Sign in again after deployment. Session signing and OAuth encryption now derive distinct keys from `SESSION_SECRET`, so an old session cannot resume.
5. Restore usable configuration through ADT. Re-enter provider API keys and Adrian credentials, reconnect Work IQ, recover authenticated MCP credentials and have a policy administrator review and re-authorize each MCP contract. Save Advisor settings and register Codex environments again. Definitions with old vault references need the UI credential recovery action before they can execute.
6. In Diagnostics, run **Test ADT Runtime** and **Test execution path**. Verify GitHub sign-in, Git-backed definitions and artifact reads, Codex Runner status, an Advisor run that uses a native tool, and an approval that resumes after restarting Runtime. Check that new history and decisions survive the restart. Then set the GitHub Actions repository variable `ADT_POSTGRES_CUTOVER_READY=true` to resume automatic Worker deployment and reopen launches.

If rollback is required, pause new launches, drain or recover new runs, and keep the PostgreSQL data and key pair. Restore the recorded Worker and Runtime revisions together with their old configuration. The two execution histories stay separate. Audit external side effects before retrying work on either deployment.

## Runtime keys and backups

- Runtime generates its 32-byte vault root and an RSA wrapping key in the persistent key directory. Private files are mode `0600`. A PostgreSQL advisory lock serializes migrations and pins the vault root fingerprint. A missing, invalid or mismatched root blocks startup. Runtime provides the wrapping public key through authenticated readiness.
- Vault encryption keys derive from the root, repository identity and key version. With Runtime stopped, the database owner can increment `active_key_version` in the singleton `adt_runtime.installation` row. On restart, Runtime uses the new version for new and replaced credentials. Earlier ciphertext remains readable with its recorded version. Rotate individual credentials through ADT and keep the root paired with its database. Replacing the root is a separate data-reset operation.
- Back up the schema with `pg_dump --format=custom --schema=adt_runtime --file=adt-runtime.dump adt` from the private database network. Store a corresponding encrypted copy of the key directory separately. Record the pair under one backup ID.
- Restore to an empty database as the Runtime role with `pg_restore --exit-on-error --no-owner --no-privileges --dbname=adt_restore adt-runtime.dump`. Restore the matching keys and their ownership and modes. Verify the restored pair and authenticated readiness on an isolated network before switching production traffic.
- Run `npm --prefix adt-runtime run build` and `adt-runtime/scripts/test-postgres.sh` for a disposable PostgreSQL integration test.

## Secret inventory

| Value | Owner and purpose |
| --- | --- |
| `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_SECRET` | Worker retains GitHub App signing and OAuth authority. |
| `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID` | Public GitHub identity settings, entered as ordinary Worker variables. |
| `SESSION_SECRET` | Worker root for browser session and GitHub OAuth encryption keys. |
| `ADT_RUNTIME_AUTH_SECRET` and `adt_runtime_auth` | Shared Worker and Runtime request authentication. |
| `adt_postgres_bootstrap_password`, `adt_postgres_app_password` | PostgreSQL bootstrap and Runtime application credentials. |
| `adt_runner_access_client_id`, `adt_runner_access_client_secret`, `adt_runner_shared_secret` | Runtime's connection to Codex Runner. Runner retains its own service credentials. |
| Runtime key directory | Runtime-generated vault root and RSA wrapping key. Persist and back up both files. |
| Optional Runtime and split Runner redeploy webhooks | Runtime-only maintenance secrets. See [Runtime operations](../adt-runtime/README.md). |

After the cutover checks and rollback retention window, remove `GITHUB_TOKEN_ENCRYPTION_KEY`, `WORKFLOW_PROVIDER_SECRET_ENCRYPTION_KEY`, `ADT_INTERNAL_AUTHORITY_SECRET`, `CODEX_RUNNER_ACCESS_CLIENT_ID`, `CODEX_RUNNER_ACCESS_CLIENT_SECRET` and `CODEX_RUNNER_SHARED_SECRET` from Cloudflare. The three Runner values must already be available in Runtime. Remove the old Worker `ADT_RUNTIME_WRAPPING_PUBLIC_KEY`, gateway URL variables and `CODEX_RUNNER_BASE_URL` if manually configured. Remove `ADT_RUNTIME_PRIVATE_KEY`, `ADT_RUNTIME_PRIVATE_KEY_FILE` and the retired `adt_runtime_private_key` mount from the Runtime stack. Keep the D1 session binding and KV catalogue cache.
