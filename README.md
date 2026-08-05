# Artifact Library

Artifact Library helps authorised users search reusable artifacts, read and copy them, create new drafts, edit their content and metadata, and safely delete them. Draft and archived changes can be applied directly, while production changes are proposed for review.

The library brings prompts, agents, snippets, templates, and app ideas into one searchable interface. It also lets users refresh the catalogue and view safe operational diagnostics when repository access or content needs attention.

**Important links**

- **Current behaviour:** [Current application specification](specs/000-current-application-spec.md)
- **Artifact format:** [External artifact repository contract](docs/external-artifact-repository-contract.md)
- **Operations:** [GitHub artifact deployment](docs/github-artifact-deployment.md)

## What users can do

### Find artifacts

Search across titles, types, statuses, tags, aliases, and Markdown bodies. Multiple terms narrow the results, while an empty search shows the complete catalogue. Result cards summarize each artifact and link to its detail page.

### Read and copy

Open an artifact to see its metadata and rendered Markdown. **Copy body** places the source Markdown body on the clipboard without its YAML frontmatter or rendered HTML.

### Create draft variations

Start from any artifact, edit a prefilled title and body, and preview the rendered variation before saving. A saved variation is a new draft linked to its source; it does not alter the source artifact.

### Create and edit artifacts

Create a draft artifact from scratch with a suggested, editable stable ID. After it is saved, its ID and type are locked. Draft and archived artifacts can be edited directly, including catalogue-backed tag autocomplete with accessible removable tag chips; production edits create a pull request instead.

### Delete artifacts safely

Deletion always requires explicit confirmation. Draft and archived artifacts are deleted directly, while deleting a production artifact creates a reviewable pull request and leaves the live artifact unchanged. Completed operations provide validated artifact, commit, pull-request, or recovery-branch links as appropriate.

### Propose production changes

For a production artifact, edit its title, tags, aliases, and Markdown body, then preview the result. Submitting opens a reviewable pull request while leaving the production artifact unchanged. If someone has changed the artifact since it was opened, the stale proposal is rejected rather than overwriting the newer version.

### Refresh the library

When catalogue caching is available, use **Refresh** to check for repository changes or **Full rebuild** to reload and validate the catalogue. If a refresh fails, the current catalogue remains in place.

### Inspect operational status

The protected diagnostics view reports safe information about the signed-in identity, repository configuration and access, required permissions, current revision, catalogue state, and artifact validation. It provides recovery guidance without exposing artifact bodies or secrets.

## Typical workflow

1. Sign in with GitHub and open the library.
2. Search by words, type, status, tag, alias, or body content.
3. Open a result to read the rendered artifact or copy its Markdown body.
4. Create a new draft, edit a draft or archived artifact directly, or create a variation.
5. Preview production edits or deletions and open their pull requests for review.
6. Follow the validated result link; if pull-request creation was interrupted, open the recovery branch.
7. Refresh the catalogue after repository changes, or use diagnostics when an operational message appears.

## How artifacts are stored

GitHub is the source of truth for artifacts. Each artifact is a Markdown file with YAML frontmatter followed by its reusable body. This is the canonical shape:

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

Required metadata:

- `id`
- `title`
- `type`
- `status`
- `tags`
- `aliases`

Optional metadata:

- `sourceId`
- `createdAt`

Supported artifact types are `prompt`, `agent`, `snippet`, `template`, and `app-idea`. Supported statuses are `production`, `draft`, and `archived`.

See the [external artifact repository contract](docs/external-artifact-repository-contract.md) for the complete layout, schema, and validation rules.

## Safety model

- Draft variations are saved separately from production changes and retain a link to their source.
- Stale revisions are rejected instead of replacing newer content.
- Stable IDs and artifact types become immutable after creation.
- Direct deletion requires confirmation; production updates and deletions use reviewable pull requests.
- Existing deterministic proposal branches are accepted only when their commit, exact tree change, and open pull request match.
- Validated result and recovery links never expose arbitrary response URLs.
- Artifact Library never merges proposals automatically.
- Credentials and tokens remain server-side and are not exposed to browser JavaScript.
- Protected pages and API responses are private and require authorised access.

## Application architecture

Artifact Library is a Next.js application deployed as a Cloudflare Worker. GitHub sign-in identifies users, and a GitHub App provides repository access. D1 stores server-side sessions, KV stores catalogue snapshots, and GitHub remains the artifact source of truth.

The maintained toolchain uses Node.js 24 and npm 11.

See [GitHub artifact deployment](docs/github-artifact-deployment.md) for deployment and operational details.

## Documentation

| Document | Purpose |
| --- | --- |
| [Current application specification](specs/000-current-application-spec.md) | Implemented user behaviour and system capabilities |
| [External artifact repository contract](docs/external-artifact-repository-contract.md) | Artifact layout, metadata, and validation rules |
| [GitHub artifact deployment](docs/github-artifact-deployment.md) | Production architecture, configuration, and operations |
| [Development workflow](docs/development-workflow.md) | Maintainer workflow and delivery process |
| [Dependency and toolchain maintenance](docs/dependency-toolchain-maintenance.md) | Runtime baseline and dependency maintenance policy |
