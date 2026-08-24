# DATA-001 External Artifact Repository Contract

This contract defines the human-editable private repository that stores Artifact Library Markdown artifacts independently from the application source repository.

## Transitional repository layout

The authoritative branch is `main`. During the repository-flattening compatibility phase, existing writes remain under the legacy `artifacts/` root. Readers and the validator also recognise the future root-level directories shown below.

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

- Markdown files may be nested below any supported directory. Root-level `agents/` is reserved for executable Agent definitions; legacy Markdown Agent artifacts remain under `artifacts/agents/`.
- Every artifact file uses the `.md` extension.
- Markdown files outside the supported top-level directories are invalid.
- Artifact, executable Agent, and Workflow IDs must each be unique across their legacy and future locations. A collision makes that domain invalid rather than selecting one file by precedence.
- Existing create, edit, delete, variation, proposal, Agent-definition, and Workflow-definition writes continue to use legacy paths. Root-level compatibility content is read-only.

## Markdown format

Artifacts are Markdown files with YAML front matter followed by the reusable artifact body.

```markdown
---
id: discovery-prompt
title: Discovery Prompt
type: prompt
status: production
tags: [discovery]
aliases: [intake]
---

Run a focused discovery interview.
```

## Front-matter schema

Required fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | non-empty string | Globally unique across the complete artifact root. |
| `title` | non-empty string | Human-readable title. |
| `type` | enum | `prompt`, `agent`, `snippet`, `template`, or `app-idea`. |
| `status` | enum | `production`, `draft`, or `archived`. Required for legacy Markdown. Optional only for root-level compatibility Markdown. |
| `tags` | string array | Use `[]` when empty. |
| `aliases` | string array | Use `[]` when empty. |

Optional fields:

| Field | Type | Notes |
| --- | --- | --- |
| `sourceId` | non-empty string | Source artifact ID for a variation or derivative. |
| `createdAt` | ISO-8601 datetime | Creation timestamp including timezone offset. |

Additional front-matter fields are not part of the stable contract and should not be required by consumers.

## Validation

Run validation from the application repository against a checked-out storage repository:

```bash
npm run artifacts:validate -- ../private-artifact-storage
npm run artifacts:validate -- ../private-artifact-storage --root custom-root
```

Validation rejects malformed front matter, missing legacy required fields, unsupported values, duplicate IDs across layouts, missing supported roots, and Markdown files outside supported legacy directories. A missing status on root-level compatibility Markdown is preserved as missing and does not imply a lifecycle state.

Representative examples are available in `docs/examples/external-artifact-repository/`.
