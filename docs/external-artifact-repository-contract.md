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
- Legacy `_adt/agents/<id>.agent.json` and `_adt/workflows/<id>.workflow.json` definitions remain readable and mutable at their exact observed paths and file revisions during Phase 4A. No physical migration occurs in this phase.
- Non-conflicting definitions may coexist across the canonical and legacy layouts. A logical ID in both layouts fails closed before mutation.
- Executable definition schemas, including their independent required `status: "draft"`, are unchanged.
- Provider connections use `connections/<id>.connection.json`. Git is authoritative per ID; absence of the directory is valid during Phase 5A.
- Connection schema v1 requires `id`, `name`, `runtime: "openai-responses"`, `provider: "openai"`, `model`, and `credential.secretRef`. The filename ID must match.
- `credential.secretRef` must use the dedicated `WORKFLOW_PROVIDER_CONNECTION_<UPPERCASE_IDENTIFIER>` Cloudflare secret-binding namespace; other Worker bindings are forbidden. Credential values, ciphertext, IVs, endpoints, and derived readiness/capabilities are forbidden.
- The ADT Connections migration view can serialize a persisted D1 connection to this exact contract and canonical path. Secret provisioning remains an external Cloudflare control-plane operation; ADT never exports the D1 credential, writes the definition to Git, or deletes the shadowed D1 row.
- Once Git is authoritative, the same-ID D1 row remains hidden from new connection discovery and is retained only for pre-migration run compatibility until a later cleanup phase.
- Git connection definitions are read-only through ADT during Phase 5A; D1 remains fallback for IDs absent from Git.

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

Phase 5B is a separate operational rollout: inspect production inventory, provision explicit secret bindings, add matching definitions to the artifact repository, and verify them before any later D1 cleanup. Phase 5A neither modifies the artifact repository nor migrates D1 rows.
