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

Markdown files may be nested below any supported directory, for example `artifacts/variations/client-a/draft.md`. Every artifact file must use the `.md` extension. Markdown files outside the supported top-level directories are invalid.

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
| `id` | non-empty string | Globally unique across the complete artifact root, including nested directories. |
| `title` | non-empty string | Human-readable title. |
| `type` | enum | One of `prompt`, `agent`, `snippet`, `template`, `app-idea`. |
| `status` | enum | One of `production`, `draft`, `archived`. |
| `tags` | string array | Use `[]` when no tags are present. |
| `aliases` | string array | Use `[]` when no aliases are present. |

Optional fields:

| Field | Type | Notes |
| --- | --- | --- |
| `sourceId` | non-empty string | ID of the source artifact for a variation or derivative. |
| `createdAt` | ISO-8601 datetime | Creation timestamp, including timezone offset such as `Z`. |

Additional front-matter fields are not part of the stable contract and should not be required by consumers.

## Validation expectations

Run validation from the application repository against a checked-out storage repository:

```bash
npm run artifacts:validate -- ../private-artifact-storage
npm run artifacts:validate -- ../private-artifact-storage --root custom-root
```

The validator reports file-specific errors for malformed YAML front matter, missing required fields, unsupported `type` or `status` values, duplicate IDs, missing expected directories, and Markdown files stored outside supported top-level directories.

## Migration guidance for current samples

Copy the existing sample files from the application repository into the storage repository under `artifacts/prompts/`, because all current samples are `type: prompt` production artifacts. Preserve each file's front matter and body, then run validation before configuring any future GitHub-backed reader.

Representative examples for every supported artifact type, including a nested variation, are available in `docs/examples/external-artifact-repository/`.
