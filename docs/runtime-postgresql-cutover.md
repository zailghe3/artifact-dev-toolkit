# Runtime PostgreSQL cutover history

**Status:** Historical migration record; not current operating procedure.

This record preserves the November 2026 migration of ADT Workflow/operational state from Cloudflare D1 into ADT Runtime PostgreSQL. Current operation is documented in [PostgreSQL operations for ADT Runtime](runtime-postgresql.md).

## Boundary change

The cutover established the current ownership model:

- D1 retained browser session state.
- Git remained authoritative for artifacts, non-secret executable definitions, and published Advisor knowledge.
- Runtime PostgreSQL became authoritative for Workflow runs/checkpoints, approvals, tool journals, provider/tool credential vault state, Advisor operational state, policy attestations, settings, and registrations.
- Runtime key material moved to a dedicated persistent private key directory.
- Codex Runner retained its independent jobs, identity, workspaces, SQLite state, and managed-repository state.
- The Worker retained user/repository authorisation and GitHub App signing authority and became the scoped repository-credential broker for Runtime.

The production cutover gate used for the migration was retired after the new Worker/Runtime deployment path was verified.

## Cutover and rollback evidence

The migration required a controlled drain of incompatible active work, preservation of the pre-cutover D1 data/keys, deployment of PostgreSQL and Runtime, and deployment of the compatible Worker.

During the rollback-retention window, the protected pre-cutover D1 export and its matching legacy encryption material were retained so the old operational state could be inspected or restored if the cutover failed. New PostgreSQL data and its Runtime key directory were treated as a separate matched recovery set.

Rollback required restoring compatible Worker/Runtime revisions together with their corresponding state/keys and auditing external side effects before retrying work. It was never safe to infer non-execution merely from a failed transport or deployment observation.

## D1 operational-state retirement

After the PostgreSQL path was verified and the rollback-retention window ended, obsolete Workflow/vault/approval/tool/Advisor operational tables in D1 became eligible for explicit retirement.

The retirement operation was intentionally separate from normal deployment:

- export D1 before destructive cleanup;
- inspect the exact table/index inventory;
- run the reviewed maintenance SQL only against the expected inventory;
- abort on unexpected schema divergence;
- verify that application-session tables remain and retired operational tables are gone;
- confirm sign-in and Artifact Library access after cleanup.

The historical maintenance script is `scripts/maintenance/retire-d1-operational-state.sql`. Current Runtime execution does not depend on those retired D1 tables.

## Retired Worker/Runtime configuration

The cutover also made several prior Worker-owned execution secrets and Runtime gateway variables obsolete. Retirement happened only after the new Runtime path was verified and recoverable backups were retained.

Examples included legacy Worker provider-vault/internal-authority secrets, direct Runner credentials formerly held by the Worker, old Runtime gateway URLs, and the separately provisioned Runtime private-key secret. Their replacement is the current Runtime PostgreSQL/key-directory model plus the authenticated Worker broker.

Exact historical names remain discoverable in repository history and the cutover PRs; they are intentionally omitted from current operator guidance so they are not mistaken for live configuration.
