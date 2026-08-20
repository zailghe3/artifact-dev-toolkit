# DATA-001 External Artifact Repository Contract

This contract defines the human-editable private repository that stores Artifact Library Markdown artifacts independently from the application source repository.

## Repository layout

The authoritative branch is `main`. The artifact root defaults to `artifacts/` and may be configured by validator callers with `--root <path>`.

```text
artifacts/
  prompts/
  agents/
  snippets/
  templates/
  app-ideas/
  variations/
```

- Markdown files may be nested below any supported directory.
- Every artifact file uses the `.md` extension.
- Markdown files outside the supported top-level directories are invalid.

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
| `status` | enum | `production`, `draft`, or `archived`. |
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

Validation rejects malformed front matter, missing required fields, unsupported values, duplicate IDs, missing expected directories, and Markdown files outside supported top-level directories.

Representative examples are available in `docs/examples/external-artifact-repository/`.
