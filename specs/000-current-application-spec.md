# Artifact Toolkit — Current Application Specification

**Document status:** Baseline specification of implemented application behaviour  
**Scope:** Current behaviour only; not a roadmap or implementation design  
**Last updated:** 2026-08-30

## 1. Purpose and scope

- Artifact Toolkit helps authorised users manage reusable work assets stored in GitHub.
- The primary asset domain is the Artifact Library.
- The application also supports durable graph-based Agent Workflows as a separate functional domain.
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
- Search covers title, description, type, tags, aliases, and body content.
- An empty search returns the complete catalogue.
- The matching result count updates with the search.

### 3.3 Artifact detail

- Users can open an artifact from the catalogue.
- The detail view presents its title, description, type, tags, aliases, and rendered Markdown body.
- Users can navigate back to the catalogue without losing the application context.
- Missing artifacts resolve to the application's not-found experience rather than an operational failure.

### 3.4 Copying

- Users can copy an artifact's reusable Markdown body.
- Users can copy the reusable body directly from either the catalogue or artifact detail.
- Copying excludes repository metadata and rendered HTML.
- The interface provides clear success feedback after copying.

## 4. Artifact creation and mutation

- An artifact present on the configured canonical branch is active catalogue content; Artifact Library Markdown has no lifecycle state.
- Users can create, preview, edit, vary, and delete artifacts without lifecycle metadata.
- New and updated Markdown omits the retired `status` field while retaining `type`.
- Top-level Artifact Library `status` metadata is invalid and is not stripped or synthesized during reads.
- Every edit and deletion is a direct Git mutation tied to the artifact's exact observed path and file revision.
- Stale or ambiguous mutations fail safely; successful writes invalidate stale catalogue state.
- Variations are distinct artifacts that retain their source relationship through `sourceId`.
- Deletion removes an artifact from the active branch. Git history is the recovery mechanism.

## 5. Repository safety

- GitHub is the source of truth for persisted artifacts.
- Direct writes create attributable repository history.
- Existing artifact mutations preserve the exact loaded source path and reject a changed file revision.
- Duplicate identities and path collisions fail closed.
- Successful changes invalidate stale catalogue state so subsequent reads can converge on repository truth.

## 6. Artifact repository contract

- Artifact Library content is Markdown with structured metadata.
- Current Artifact Library categories are prompts, snippets, templates, and app ideas.
- Variations are ordinary same-type artifacts linked through `sourceId`.
- Executable Agents, Workflows, layouts, and provider connections use separate canonical JSON namespaces and are not Artifact Library Markdown.
- Repository content is validated before it becomes active application content.
- Unsupported or retired locations, malformed metadata, duplicate identities, and unsafe content fail closed.
- The canonical repository layout and validation rules are defined by the [External Artifact Repository Contract](../docs/external-artifact-repository-contract.md).

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
- Diagnostics groups overall health, authentication and access, Artifact Library, application control-plane, ADT Runtime, and Codex Runner observations into distinct operational domains.
- Runtime and Runner readiness diagnostics remain bounded, exclude secrets and private Runner information, and do not invoke a provider or start model-directed execution.
- An authorised user may explicitly run a non-mutating Runtime execution-path diagnostic that reports checkpoint, graph-node, and optional Artifact Search callback reachability, narrow-authority acceptance, and required control-plane backend availability. Passive page loading never starts this diagnostic, and its ephemeral result does not change overall health.
- Overall health includes required ADT Runtime configuration and current Workflow graph capability, while an intentionally unconfigured optional Codex Runner does not make the application unhealthy.
- Codex Runner overview health includes compatible connection and CLI versions plus bounded execution-boundary, enabled-environment, sandbox, current-operation, and authentication-environment observations.
- Detailed Codex Runner operational controls and explicit functional testing remain separate from the unified diagnostics overview.
- Diagnostics is observational unless the user explicitly invokes a supported active action such as catalogue refresh or the non-mutating Runtime execution-path test.
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

- Artifact Toolkit supports durable Workflow v2 graphs composed of configured Agents and deterministic control blocks.
- Workflows, runs, provider connections, retries, cancellation, approvals, and execution providers form a separate functional domain from the Artifact Library.
- Workflow execution must remain bounded, durable, observable, and safe against accidental duplicate external work.
- Provider and Runner credentials remain outside user-authored Workflow definitions.
- Current graph capabilities, execution semantics, and limitations are defined in [Agent Workflows](agent-workflows.md).

## 11. Current product boundaries

- Artifact repository configuration and external service provisioning remain operator responsibilities.
- Operational documentation may prescribe deployment technologies, versions, limits, or recovery procedures without making those mechanics part of this product specification.
- Detailed Agent Workflow, provider, Runtime, and Runner behaviour remains in the dedicated Workflow specification and component documentation.
