# PostgreSQL operations for ADT Runtime

ADT Runtime uses PostgreSQL for durable Conversations, Workflows, and their operational state and a separate persistent key directory for its encrypted vault/wrapping identity. The database and matching key material form one recovery set.

The completed D1-to-PostgreSQL migration is preserved in [PostgreSQL cutover history](runtime-postgresql-cutover.md); it is not part of normal current operation.

## Prepare the stack

Use [the standalone Runtime/PostgreSQL stack](../adt-runtime/docker-stack.example.yml) when Runtime owns a dedicated PostgreSQL service, or [the Runtime-only stack](../adt-runtime/docker-stack.existing-postgres.example.yml) when PostgreSQL is operated separately.

Current deployment invariants:

- PostgreSQL stays on a private network and is not published directly to the Internet.
- Runtime uses a dedicated non-superuser database role with the privileges required to own and migrate its application schema.
- PostgreSQL data and Runtime key material use separate persistent storage.
- The Runtime key directory is writable only by the Runtime service identity and supports durable atomic filesystem operations.
- Runtime receives only the service credentials it needs: Worker/Runtime authentication, PostgreSQL access, and Codex Runner service credentials where Runner integration is enabled.
- Delegated tool-policy roles are configured explicitly; repository access alone does not imply policy-administrator, approver, or reconciliation authority.
- Private provider/tool/infrastructure services remain reachable from the Runtime/private-service boundary rather than being exposed to the Cloudflare Worker.

The committed stack examples remain authoritative for exact variable names, secret mounts, storage drivers, healthchecks, network names, and resource settings.

## Deploy and verify

- Deploy an immutable published Runtime image when performing an explicit production rollout; keep PostgreSQL and the Runtime key export attached to the intended service.
- Runtime readiness requires a working database connection, compatible schema, and matching key material.
- Use **Test ADT Runtime** for authenticated service compatibility.
- Use **Test execution path** in Diagnostics to verify Runtime management/storage and the scoped GitHub broker without invoking a provider.
- Verify that Conversation history and the saved Codex environment list load in an authorised repository session.
- Verify a representative durable Workflow operation after infrastructure changes, including persistence across a Runtime restart where practical.
- Verify provider/tool/Runner integrations separately; one healthy dependency does not prove another is ready.

Normal Worker deployment and Runtime image publication are controlled by the trusted repository delivery workflows. Operator deployment of the homelab Runtime/private infrastructure remains separate.

### Deploy Conversations

- Roll out a Runtime image with the Conversation and response-section migrations before deploying the Conversation Worker routes. Runtime applies the migrations during startup using its existing PostgreSQL role.
- Keep the PostgreSQL volume and matching key directory attached. Existing Runs and knowledge proposals are preserved. Preview response actions are available when the completed checkpoint verifies their execution.
- A Worker can be rolled back independently. Runtime rollback requires a build that understands the applied migration ledger or a restore of the matching pre-upgrade database and keys.

## Diagnose Workflow management

When Workflow history or management operations fail:

1. Check passive Runtime readiness and expected release compatibility.
2. Run **Test execution path** and inspect its bounded management/storage observations.
3. Retry the affected Workflow history view in the same authorised session.
4. Use the safe correlation identifiers from the technical report to match Worker and Runtime structured logs.
5. Diagnose Runner or provider readiness independently when the failure belongs to those boundaries.

Diagnostics report bounded status/evidence only. Raw SQL, credentials, Workflow content, upstream bodies, and internal exception text are not diagnostic output.

### Diagnose settings requests

For a Codex environment settings error, match the request ID from the API response to the Worker and Runtime settings logs. Use the logged stage and classification to locate the failure in ingress routing, signed authentication, replay protection, PostgreSQL access, or response validation. Management and settings use separate signed endpoints, so confirm that ingress routes the settings endpoint when management succeeds and settings report a routing failure.

## Recover from a Runtime/PostgreSQL issue

- Stop or pause new execution before a recovery that may change database/key state.
- Preserve the current PostgreSQL data and matching Runtime key directory before attempting repair.
- Roll back Runtime only to a version compatible with the retained schema and service contract.
- Audit ambiguous external provider/tool/Runner work before retrying affected Workflow operations.
- Restore database and keys as a matched pair; a database with unrelated key material must fail closed.
- After recovery, verify authenticated readiness, Workflow history, one durable execution path, and the external integrations relevant to the incident.

Browser sessions remain in D1 and catalogue acceleration remains in KV; neither substitutes for Runtime PostgreSQL recovery.

## Runtime keys and backups

- Runtime generates and persists the vault root and wrapping-key material in its protected key directory.
- Runtime pins key identity to its database state and refuses to start when the required key material is missing or inconsistent.
- Vault encryption is repository-scoped and versioned so credential rotation does not require rewriting unrelated operational history.
- Back up the Runtime schema with PostgreSQL-native tools and back up the matching key directory separately under one recovery identifier.
- Restore into an isolated environment first, verify the key/database pair and authenticated Runtime readiness, then switch production traffic deliberately.
- Keep backup storage and access independent from the running Runtime service where practical.

For a disposable PostgreSQL integration check, use the Runtime build plus `adt-runtime/scripts/test-postgres.sh`. Exact backup commands, schema names, role names, and migration mechanics remain authoritative in the committed stack/migration/test tooling.

## Secret and authority ownership

| Value / authority | Owner and purpose |
| --- | --- |
| GitHub App signing/OAuth secrets | Cloudflare Worker; user/repository admission and scoped GitHub authority |
| Worker/Runtime shared service secret | Worker and Runtime only; authenticates their service boundary |
| PostgreSQL application credential | Runtime; access to its operational database |
| Runtime key directory | Runtime; encrypted vault and wrapping identity |
| Provider, MCP, Work IQ, and Security Profile credentials | Runtime encrypted repository-scoped vault |
| Codex Runner service credentials | Runtime; bounded access to the independently trusted Runner |
| Codex identity | Runner Executor; never stored by Worker or Runtime |
| Managed GitHub operation credentials | minted by Worker for the exact admitted Runtime/Runner operation |
| Optional Runtime/Runner redeploy webhooks | Runtime-only maintenance authority for fixed private infrastructure targets |

Do not provision browser-session secrets, GitHub App private signing keys, Codex identity, Docker socket access, or broad Portainer API credentials to Runtime.

Runtime's broader architectural role—including the thin-Worker/private-service direction—is tracked in [Architecture](../ARCHITECTURE.md#key-architectural-invariants). This guide is limited to current PostgreSQL/key operation and recovery.
