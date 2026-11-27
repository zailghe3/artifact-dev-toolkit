# Artifact Toolkit — Current Application Specification

**Document status:** Baseline specification of implemented application behaviour  
**Scope:** Current behaviour only; not a roadmap or implementation design

## 1. Purpose and scope

- Artifact Toolkit helps authorised users manage reusable work assets stored in GitHub.
- The Artifact Library is the primary reusable-content domain.
- Conversations are the primary interface for interactive Agent and Workflow execution.
- This specification describes stable product behaviour and safety invariants.
- Agent, Workflow, provider, tool, Runtime, and Runner behaviour is specified in [Agent Workflows](agent-workflows.md) and owning component documentation.

## 2. Access and security

- GitHub authentication establishes user identity.
- Application access additionally requires current authority to the configured artifact repository and may be further restricted by operator policy.
- Browser sessions are server-controlled, revocable, and contain no GitHub or application credentials.
- Repository authority is revalidated during a session rather than trusted indefinitely from login.
- Privileged GitHub operations use server-side short-lived, repository-scoped authority limited to the admitted operation.
- User identity, GitHub App authority, provider/tool credentials, Runtime authority, and Codex identity remain separate security boundaries.
- Protected responses are not publicly cacheable.
- User-facing errors and diagnostics do not expose credentials, private repository content, unsafe upstream responses, or internal exception text.

## 3. Artifact Library

- The library presents validated prompts, snippets, templates, and app ideas from the configured repository.
- Users can search the loaded catalogue by relevant metadata and body text.
- Users can open rendered artifact details and copy the reusable Markdown body without repository metadata.
- Missing artifacts use the normal not-found experience rather than an operational failure.
- Healthy catalogue state remains secondary to the primary content workflow; stale, degraded, or unavailable state is visible when it affects use.

## 4. Artifact creation and mutation

- Artifact Library Markdown has no lifecycle state. Content on the configured canonical branch is active catalogue content.
- Users can create, preview, edit, vary, and delete artifacts.
- Variations are ordinary same-type artifacts linked through `sourceId`.
- Existing mutations use the exact observed source path and revision.
- Stale, conflicting, or ambiguous writes fail safely.
- An uncertain mutation is never automatically replayed; the user is told to re-check repository state before resubmitting.
- Successful writes invalidate stale catalogue state.
- Git history is the recovery source for deleted or changed artifact content.

## 5. Repository contract and freshness

- GitHub is authoritative for Artifact Library content.
- Repository content is validated before it becomes active application content.
- Unsupported locations, malformed metadata, duplicate identities, unsafe content, and path/revision conflicts fail closed.
- The application may cache validated catalogue data, but cache state is disposable and tied to repository truth.
- A failed refresh does not discard an otherwise safe last-known-good catalogue.
- Users can request normal refresh and full rebuild where supported.
- The canonical repository contract is [DATA-001](../docs/external-artifact-repository-contract.md).

## 6. Diagnostics and operational experience

- Authorised users have one protected Diagnostics & maintenance surface for bounded operational observations.
- Diagnostics displays its domain headings while passive observations are in progress.
- Authentication, Artifact Library, control-plane, Runtime, and Runner results appear as their dependencies complete. Other domains remain usable when an observation fails.
- Overall health remains unconfirmed while required observations are pending. A previous result retains its observed time and is identified as stale when a refresh fails.
- Passive observation, explicit active diagnostics, and state-changing maintenance actions are distinct.
- Active diagnostics are bounded, intentional, and do not silently start model work or mutate application data unless the action explicitly says it will.
- Component reachability, authentication, compatibility, storage readiness, provider readiness, and execution readiness remain distinguishable where that distinction affects recovery.
- A failed re-query does not present stale observations as current.
- Runner readiness, execution controls, and copied reports use the same current control evidence. State-dependent controls require a confirmed latch state. After an uncertain control operation, a fresh observation is required to verify the current latch state.
- Degraded optional detail does not invalidate separately established healthy core functionality.
- Operational failures provide concise safe recovery guidance where possible.
- Status does not rely on colour alone.
- Copyable diagnostic summaries use explicit safe fields and exclude secrets, prompts, private artifact bodies, raw upstream payloads, and internal exception text.

## 7. Application interface

- Protected pages share persistent navigation for Conversations, Advisor, Workflows, Artifacts, and Diagnostics.
- Workflow navigation includes runs, definitions, Agents, Connections, Tools, and Security. Advisor navigation includes the knowledge library.
- Desktop navigation supports expanded and icon-only views and retains the chosen width. Mobile navigation opens in a dismissible drawer and closes when a destination is selected.
- Page headings and static actions appear while slow sections load when their authorization permits. Section failures preserve access to unrelated results and navigation.
- The application supports light and dark themes with persistent user preference.
- Interactive controls expose accessible labels, focus states, and semantic navigation.
- Status and warnings combine text with visual treatment and do not dominate healthy workflows.
- User-facing times use local presentation while preserving canonical timestamps where needed.
- Safe deployment/component identity and freshness may be shown without requiring independent services to share a Git revision.
- Confirmed component maintenance can be presented as an explicit authorised action when the owning service exposes that capability.
- Maintenance completion requires a fresh observation that the targeted component is current.
- Unavailable maintenance or freshness observations never block unrelated application use, and uncertain maintenance outcomes are not automatically retried.

## 8. Agent Workflows

- Artifact Toolkit supports bounded durable Workflow graphs composed of configured Agents and deterministic control blocks.
- Workflows, runs, provider Connections, Tools, Security Profiles, retries, cancellation, approvals, and execution providers form a separate domain from the Artifact Library.
- Workflow execution remains durable, observable, bounded, and safe against accidental duplicate external work.
- Provider, tool, Runner, and infrastructure credentials remain outside user-authored Workflow definitions.
- Current Workflow behaviour is defined in [Agent Workflows](agent-workflows.md).

## 9. Conversations

- Authorised repository users can start, search, rename, reopen, and continue Conversations.
- A Conversation keeps its selected Agent or Workflow. Each message starts a distinct durable Run with the latest authorised definitions. Earlier Runs keep their frozen snapshots.
- A Conversation permits one active turn at a time. Replay resolves to the same turn and Run. Eligible retry reuses the latest failed Run and its snapshots.
- Follow-up context includes successful user messages and visible response sections. Runtime retains recent and requested exact exchanges within its budget and carries forward a bounded summary of earlier exchanges. The timeline flags shortened or omitted history.
- The timeline shows execution status, approvals, failures, retries, definition changes, and links to the underlying Runs.
- Responses support safe rendered Markdown, raw viewing, and copying the complete response, a section, or a code block.
- Actions appear in execution order on sections verified against the successfully completed Workflow. Repeated visits to a block can produce distinct actions. Model text has no action authority.
- Standalone Runs remain available in Workflow history and through their original URLs.
- See [Using Conversations](../docs/conversations.md).

## 10. Advisor and knowledge

- Advisor opens the shared Conversations interface filtered to the designated `advisor` Workflow.
- Advisor uses the selected Agents and Connections from that Workflow and the same Git-defined execution policy as other entry points. Previously protected Advisor definitions need explicit configuration before they can start new Runs with standard authority.
- An authorised Workflow can use a Knowledge Proposal block to offer later review of a selected output. The Workflow completes independently of the review.
- The action opens an editable proposal with source Run and revision provenance. Approved knowledge lives in Git, while proposals and publication state live in Runtime.
- Each publication requires an authenticated human review and explicit consent for the exact proposal revision. Stale or uncertain publication is never automatically replayed.
- Sensitive observability reads require exact-call human approval and current authority.
- See [Advisor setup](../docs/advisor-setup.md).

## 11. Current product boundaries

- Artifact repository configuration, external provider/service provisioning, Runtime/Runner deployment, and private infrastructure remain operator responsibilities.
- The Cloudflare application is intentionally a thin public control plane; durable execution and private-service integration belong in Runtime or another trusted service boundary.
- Operational documentation may prescribe current deployment technologies and recovery procedures without making those mechanics part of this product specification.
- Source, tests, schemas, migrations, configuration, and component documentation remain authoritative for replaceable implementation details.
