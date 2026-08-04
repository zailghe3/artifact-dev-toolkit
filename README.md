# Artifact Library

Artifact Library helps authorised users search a collection of reusable artifacts, read their rendered content, copy their Markdown bodies, create draft variations, preview proposed content, and propose changes to production artifacts. These tasks can be completed in the application without manually editing files in the artifact repository.

The library brings prompts, agents, snippets, templates, and app ideas into one searchable interface. It also lets users refresh the catalogue and view safe operational diagnostics when repository access or content needs attention.

**Important links**

- **Application:** _Deployment URL requires maintainer input._
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
4. Create and preview a draft variation when exploring an alternative.
5. For a production artifact, preview an edit and open a pull request for review.
6. Refresh the catalogue after repository changes, or use diagnostics when an operational message appears.

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
- Production updates are proposed through reviewable pull requests.
- Artifact Library never merges proposals automatically.
- Credentials and tokens remain server-side and are not exposed to browser JavaScript.
- Protected pages and API responses are private and require authorised access.

## Application architecture

Artifact Library is a Next.js application deployed as a Cloudflare Worker. GitHub sign-in identifies users, and a GitHub App provides repository access. D1 stores server-side sessions, KV stores catalogue snapshots, and GitHub remains the artifact source of truth.

See [GitHub artifact deployment](docs/github-artifact-deployment.md) for deployment and operational details.

## Documentation

| Document | Purpose |
| --- | --- |
| [Current application specification](specs/000-current-application-spec.md) | Implemented user behaviour and system capabilities |
| [External artifact repository contract](docs/external-artifact-repository-contract.md) | Artifact layout, metadata, and validation rules |
| [GitHub artifact deployment](docs/github-artifact-deployment.md) | Production architecture, configuration, and operations |
| [Development workflow](docs/development-workflow.md) | Maintainer workflow and delivery process |
| [Dependency and toolchain maintenance](docs/dependency-toolchain-maintenance.md) | Runtime baseline and dependency maintenance policy |

## Security

Access is limited to authenticated users who are authorised for the configured artifact repository. Report security concerns through the repository owner's private security channel; a public security contact has not yet been documented.

## Licence

_No licence has been documented. Maintainer input is required before reuse or redistribution._
