# DATA-001 External Artifact Repository Contract

This contract defines the human-editable private repository that stores Artifact Library Markdown independently from the application source repository.

## Transitional repository layout

The authoritative branch is `main`. The retained transitional layout reads the configured legacy compatibility root (`artifacts/` by default) alongside ordinary root-level type directories. Phase 3 completes Artifact Library lifecycle removal without moving those directories.

```text
artifacts/
  prompts/
  agents/
  snippets/
  templates/
  app-ideas/
  variations/

prompts/
snippets/
templates/
app-ideas/

agents/
  *.agent.json
workflows/
  *.workflow.json
  *.layout.json
connections/
  *.connection.json
```

- Markdown may be nested below a supported directory and uses the `.md` extension.
- Root-level `agents/` and `workflows/` are reserved for executable JSON definitions and are not Artifact Library Markdown namespaces. Historical Markdown Agent artifacts remain under `<configured-legacy-root>/agents/` during Phase 4A.
- New prompt, snippet, template, and app-idea Markdown uses its root-level type directory. New Markdown Agent artifacts continue to use the configured legacy root.
- Existing Markdown is edited or deleted at its exact physical path and observed Git revision.
- New variations use the applicable same-type write directory and carry `sourceId`. The legacy `variations/` directory remains read and exact-path mutation compatibility only.
- IDs are unique across supported layouts. Collisions fail closed rather than selecting a file by precedence.
- New executable definitions use canonical root paths: `agents/<id>.agent.json` and `workflows/<id>.workflow.json`.
- Optional Workflow layouts use the co-located canonical path `workflows/<id>.layout.json`. Layout schema v1 contains only the matching Workflow ID, positions keyed by stable step ID, and viewport position/zoom.
- Workflow layout is presentation state rather than executable Workflow configuration. It does not contain Agents, step order, routing, credentials, run state, or duplicated Workflow semantics.
- Layout creation and updates use independent revision-aware Git mutations. Missing layouts are valid and do not affect Workflow viewing or execution.
- Legacy `_adt/agents/<id>.agent.json` and `_adt/workflows/<id>.workflow.json` definitions remain readable and mutable at their exact observed paths and file revisions during Phase 4A. No physical migration occurs in this phase.
- Non-conflicting definitions may coexist across the canonical and legacy layouts. A logical ID in both layouts fails closed before mutation.
- Executable definition schemas, including their independent required `status: "draft"`, are unchanged.
- Provider connections use `connections/<id>.connection.json`. Git is authoritative per ID; absence of the directory is valid.
- Connection schema v1 requires `id`, `name`, `runtime` (`"openai-responses"` or `"openai-agents"`), `provider: "openai"`, `model`, and `credential.secretRef`. The filename ID must match.
- Target credentials use `credential.source: "adt-vault"` with a canonical opaque `sec_...` reference. Source-less `WORKFLOW_PROVIDER_CONNECTION_<UPPERCASE_IDENTIFIER>` references remain valid transitional Cloudflare bindings. Source/reference combinations are validated exactly; credential values, ciphertext, IVs, endpoints, and derived readiness/capabilities are forbidden.
- The ADT Connections migration view can explicitly migrate an active legacy D1 credential or source-less Cloudflare binding server-side. D1 migration creates the same-ID canonical Git definition with a new `adt-vault` reference; Cloudflare-binding migration revision-safely replaces only the credential source and reference. Neither path transfers credential plaintext through the browser or Git.
- Once Git is authoritative, the same-ID D1 row remains hidden from new connection discovery and is retained only for pre-migration run compatibility until a later cleanup phase.
- ADT may edit the supported non-secret fields of a Git connection using its exact observed revision. Credential value changes do not alter the Git definition or stable vault reference. Legacy D1 connections remain fallback only for IDs absent from Git.

## Markdown format

Canonical Artifact Library Markdown has no lifecycle status. `type` remains required.

```markdown
---
id: discovery-prompt
title: Discovery Prompt
type: prompt
tags: [discovery]
aliases: [intake]
---

Run a focused discovery interview.
```

Derivatives additionally use `sourceId`.

### Required front matter

| Field | Type | Notes |
| --- | --- | --- |
| `id` | non-empty string | Unique across all supported Artifact Library locations. |
| `title` | non-empty string | Human-readable title. |
| `type` | enum | `prompt`, `agent`, `snippet`, `template`, or `app-idea`. |
| `tags` | string array | Use `[]` when empty. |
| `aliases` | string array | Use `[]` when empty. |

Optional canonical fields are `description` (string), `sourceId` (non-empty string), and `createdAt` (ISO-8601 datetime with an offset).

## Lifecycle invariant

- Top-level Artifact Library `status` is not part of the repository contract and makes Markdown invalid.
- Readers do not strip lifecycle metadata or synthesize lifecycle state.
- ADT writes statusless Markdown and requires `type`.
- Artifact visibility and revision-aware mutation are independent of lifecycle state.
- Deletion removes content from the active branch; Git history provides recovery.

Additional front-matter fields are not stable contract fields and must not be required by consumers.

## Validation

```bash
npm run artifacts:validate -- ../private-artifact-storage
npm run artifacts:validate -- ../private-artifact-storage --root custom-root
```

Validation accepts statusless Markdown across the transitional repository layouts. It rejects top-level Artifact Library `status`, malformed canonical metadata, duplicate IDs, unsafe or unsupported paths, oversized/unsafe content where applicable, and repository corruption. Agent and Workflow JSON validation is independent and unchanged. Connection JSON validation rejects malformed or unsupported schemas, unsafe paths, identity mismatch or duplication, unsupported runtime/provider combinations, invalid models or secret references, and semantic plaintext credential material.

Legacy source-less bindings remain schema-compatible for historical snapshots and unmigrated connections. Explicit migration retains both existing Cloudflare bindings and legacy D1 rows for historical Workflow compatibility; retirement is a separate cleanup concern.
