# DATA-001 External Artifact Repository Contract

This contract defines the human-editable private repository that stores Artifact Library Markdown independently from the application source repository.

## Transitional repository layout

The authoritative branch is `main`. The retained transitional layout reads the configured legacy compatibility root (`artifacts/` by default) alongside ordinary root-level type directories. Phase 3A changes Artifact Library status semantics without moving those directories.

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
```

- Markdown may be nested below a supported directory and uses the `.md` extension.
- Root-level `agents/` is reserved for executable definitions. Markdown Agent artifacts remain under `<configured-legacy-root>/agents/` until Phase 4.
- New prompt, snippet, template, and app-idea Markdown uses its root-level type directory. New Markdown Agent artifacts continue to use the configured legacy root.
- Existing Markdown is edited or deleted at its exact physical path and observed Git revision.
- New variations use the applicable same-type write directory and carry `sourceId`. The legacy `variations/` directory remains read and exact-path mutation compatibility only.
- IDs are unique across supported layouts. Collisions fail closed rather than selecting a file by precedence.
- Executable `*.agent.json` and `*.workflow.json` definitions, including their independent required `status: "draft"`, are unchanged. Legacy `_adt/agents` and `_adt/workflows` definitions have not moved.

## Markdown format

Canonical Phase 3A Markdown has no lifecycle status. `type` remains required.

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

## Phase 3A read compatibility

- Legacy Artifact Library Markdown may temporarily carry `status: draft`, `status: production`, or `status: archived` in any supported Markdown location.
- Readers validate those legacy values but do not expose or synthesize lifecycle state.
- Legacy status has no effect on visibility, mutability, variation eligibility, or direct revision-aware edit/delete behaviour.
- ADT never writes `status`; a normal edit serializes the canonical statusless form.
- Deletion from the active branch is the archive mechanism and Git history provides recovery.
- Existing storage-repository files may retain status until the separate Phase 3B cleanup. This contract does not claim that cleanup has occurred.

Additional front-matter fields are not stable contract fields and must not be required by consumers.

## Validation

```bash
npm run artifacts:validate -- ../private-artifact-storage
npm run artifacts:validate -- ../private-artifact-storage --root custom-root
```

Validation accepts statusless and transitional mixed Markdown repositories. It rejects malformed canonical metadata, invalid legacy status values, duplicate IDs, unsafe or unsupported paths, oversized/unsafe content where applicable, and repository corruption. Agent and Workflow JSON validation is independent and unchanged.
