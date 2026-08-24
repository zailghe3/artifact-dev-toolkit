# Artifact Toolkit — Current Application Specification

**Document status:** Baseline specification of implemented application behaviour  
**Scope:** Current behaviour only; not a roadmap or implementation design  
**Last updated:** 2026-08-20

## 1. Purpose and scope

- Artifact Toolkit helps authorised users manage reusable work assets stored in GitHub.
- The primary asset domain is the Artifact Library.
- The application also supports durable sequential Agent Workflows as a separate functional domain.
- This specification describes stable product behaviour and important safety invariants.
- Implementation details belong in code, component documentation, operational documentation, or external contracts.
- Agent Workflow behaviour is specified separately in [Agent Workflows](agent-workflows.md).

## 2. Access and security

- Users authenticate with GitHub.
- Access is limited to users authorised for the configured artifact repository.
- Application pages and APIs containing private repository information require authenticated and authorised access.
- Signing out invalidates the application session.
- Credentials, access tokens, provider secrets, and other sensitive configuration remain server-side.
- Protected responses are not publicly cacheable.
- User-facing errors and diagnostics must not expose secrets, raw credentials, private artifact bodies, or unsafe upstream responses.
- Repository and provider permissions follow least-privilege boundaries appropriate to the requested operation.

## 3. Artifact Library

### 3.1 Catalogue

- The library presents the validated artifacts available from the configured repository.
- Artifacts are presented in a consistent, searchable catalogue.
- The workspace shows concise catalogue counts and a clear action to create an artifact.
- Normal healthy catalogue state should not displace the primary artifact workflow.
- Stale, degraded, or unavailable states should be visible when they materially affect use.

### 3.2 Search

- Users can search the loaded artifact catalogue interactively.
- Search is case-insensitive.
- Multiple search terms narrow the result set.
- Search covers artifact identity, type, status, tags, aliases, and body content.
- An empty search returns the complete catalogue.
- The matching result count updates with the search.

### 3.3 Artifact detail

- Users can open an artifact from the catalogue.
- The detail view presents its title, type, status, tags, aliases, and rendered Markdown body.
- Users can navigate back to the catalogue without losing the application context.
- Missing artifacts resolve to the application's not-found experience rather than an operational failure.

### 3.4 Copying

- Users can copy an artifact's reusable Markdown body.
- Copying excludes repository metadata and rendered HTML.
- The interface provides clear success feedback after copying.

## 4. Artifact creation and lifecycle

### 4.1 Lifecycle states

- Base artifacts are created as drafts.
- Supported lifecycle states are draft, production, and archived.
- Draft and archived artifacts may be changed directly.
- Production changes are proposed for review rather than applied directly.
- Artifact identity and type become stable after creation.

### 4.2 Creating artifacts

- Users can create a new draft artifact from the application.
- The application suggests an artifact ID that remains editable until first successful save.
- Users can edit the artifact's title, tags, aliases, and Markdown body before saving.
- Users can preview a proposed artifact without writing to the repository.
- Duplicate or invalid artifacts are rejected before persistence.

### 4.3 Editing artifacts

- Users can edit supported artifact metadata and Markdown body.
- Draft and archived changes are persisted directly after validation.
- Production changes create a reviewable proposal and leave the current production artifact unchanged.
- The application detects stale concurrent edits and must not silently overwrite a newer repository revision.
- A successful direct save becomes the editor's new persisted baseline.

### 4.4 Variations

- Users can create a draft variation from an existing artifact.
- A variation starts with the source artifact's body and relevant metadata.
- The user may change the variation title and body before saving.
- Saving creates a distinct draft rather than modifying the source artifact.
- The variation retains a relationship to its source.
- Previewing a variation performs no repository write.

### 4.5 Deletion

- Deletion always requires explicit user confirmation.
- Draft and archived artifacts may be deleted directly.
- Production deletion creates a reviewable proposal and leaves production unchanged until reviewed externally.
- Deletion uses the persisted artifact revision rather than unsaved editor changes.
- Stale deletion attempts are rejected rather than deleting a newer revision.

## 5. Production review and repository safety

- GitHub is the source of truth for persisted artifacts.
- Direct writes create attributable repository history.
- Production update and deletion proposals are represented as reviewable GitHub pull requests.
- The application does not automatically merge production proposals.
- Proposal creation must be safe to retry or recover without accidentally duplicating repository mutations.
- An already completed equivalent proposal may be reused.
- A conflicting existing proposal must fail safely rather than being overwritten.
- Interrupted proposal creation should expose safe recovery information when available.
- Successful direct changes invalidate stale catalogue state so subsequent reads can converge on repository truth.

## 6. Artifact repository contract

- Artifacts are Markdown-based reusable assets with structured metadata.
- Supported artifact categories include prompts, agents, snippets, templates, app ideas, and variations.
- Artifact IDs are unique within the configured artifact repository.
- Repository content is validated before it becomes part of the application catalogue.
- During repository-layout migration, the library can read non-conflicting legacy and compatible root-level artifacts while all mutations remain limited to legacy, lifecycle-managed content.
- A logical identity present in both repository layouts fails closed, and statusless compatibility content has no implied lifecycle state.
- Invalid paths, malformed metadata, duplicate identities, unsupported content, and unsafe artifact data are rejected.
- The canonical repository layout, metadata schema, and validation rules are defined by the [External Artifact Repository Contract](../docs/external-artifact-repository-contract.md).
- The application specification should not duplicate that contract.

## 7. Catalogue freshness and refresh

- The application may cache validated catalogue data to reduce repository reads.
- Cached content remains tied to the repository revision from which it was built.
- The application checks for repository changes before treating expired catalogue data as current.
- Users can request a normal refresh when supported by the configured repository backend.
- Users can request a full rebuild when a complete catalogue reload is needed.
- A failed refresh does not discard an otherwise safe last-known-good catalogue.
- Temporary cache failure may degrade performance or freshness without making healthy repository content unavailable.
- Repository, authorisation, content-validation, and configuration failures fail closed when safe content cannot be established.

## 8. Diagnostics and operational experience

- Authorised users can inspect a protected diagnostics view.
- Diagnostics reports safe information needed to understand repository access, configuration, permissions, catalogue state, validation, and supported connected services.
- Diagnostics is observational unless the user explicitly invokes a supported recovery action such as catalogue refresh.
- Operational states distinguish healthy, degraded, unavailable, unauthorised, misconfigured, and invalid-content conditions where relevant.
- Degraded states should preserve safe usable functionality where possible.
- Blocking states should provide concise recovery guidance.
- Diagnostic statuses must be understandable without relying on colour alone.
- User-facing event times use the user's local presentation while retaining canonical timestamps where appropriate.
- Diagnostics must not expose secrets, tokens, private artifact bodies, cache contents, arbitrary upstream responses, or internal exception text.

## 9. Application interface

- Protected application pages share a consistent application header and primary navigation.
- Primary navigation includes the major functional areas available to the user.
- The interface is responsive across desktop and mobile layouts.
- The application supports light and dark themes.
- Theme changes apply immediately and persist for the user.
- Interactive controls provide accessible labels, focus states, and semantic navigation.
- Status information combines text with visual treatment.
- Operational warnings remain concise and do not dominate healthy workflows.
- Deployment identity may expose safe source and deployment metadata without exposing private configuration.

## 10. Agent Workflows

- Artifact Toolkit supports durable sequential workflows composed of configured agents.
- Workflows, runs, provider connections, retries, cancellation, and the Codex Runner form a separate functional domain from the Artifact Library.
- Workflow execution must remain bounded, durable, observable, and safe against accidental duplicate external work.
- Provider and Runner credentials remain outside user-authored workflow definitions.
- Current workflow capabilities and limitations are defined in [Agent Workflows](agent-workflows.md).

## 11. Current product boundaries

- The application does not automatically merge production artifact proposals.
- Artifact repository configuration and external service provisioning remain operator responsibilities.
- Operational documentation may prescribe specific deployment technologies, versions, limits, or recovery procedures without making those implementation choices part of this product specification.
- Agent Workflows are currently sequential and bounded; their detailed limitations are maintained in the dedicated workflow specification.
