# Artifact Library

A fast, local-first Next.js app for reusable consulting and development artifacts: prompts, agents, snippets, templates, and app ideas.

Artifacts are Markdown files with YAML frontmatter under `artifacts/`. Variations are saved as new Markdown files under `artifacts/variations/`.

## Features

- Home page search across title, type, status, tags, aliases, and body.
- Artifact cards showing title, type, tags, and status.
- Detail pages with rendered Markdown.
- One-click copy for the artifact body.
- Local variation editor that writes a new Markdown file.
- Seed prompt examples for board updates, slide narratives, Copilot coding, and meeting summaries.

## Artifact format

```md
---
id: slide-narrative-builder
title: Slide Narrative Builder
type: prompt
status: production
tags: [consulting, slides, narrative]
aliases: [deck, storyline, slide story]
---

Prompt body here.
```

Supported `type` values: `prompt`, `agent`, `snippet`, `template`, `app-idea`.

Supported `status` values: `production`, `draft`, `archived`.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
npm run typecheck
npm run build
```

## GitHub automation

This repository includes GitHub Actions for pull request validation, optional auto-merge, and Cloudflare publication.

### Pull request checks

`CI` runs on pull requests and pushes to `main`:

```bash
npm install
npm run typecheck
npm run build
```

### Auto-merge

To let GitHub merge a pull request after required checks pass:

1. Enable **Allow auto-merge** in the repository settings.
2. Configure branch protection on `main` so the `CI / Typecheck and build` check is required.
3. Add the `auto-merge` label to a non-draft pull request.

The `Auto-merge pull requests` workflow calls `gh pr merge --auto --squash --delete-branch`, so GitHub performs the merge only after required checks and branch protection rules are satisfied.

### Cloudflare publication

`Publish to Cloudflare` runs after commits land on `main` and can also be started manually from the Actions tab. It builds the OpenNext Cloudflare worker and publishes it with Wrangler.

Add these repository secrets before enabling production publication:

- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with permission to deploy the configured worker.
- `CLOUDFLARE_ACCOUNT_ID` — the target Cloudflare account ID.

The deployed worker is configured in `wrangler.jsonc`.

Local file writes for variation creation work in local development. On hosted deployments, runtime filesystem writes are ephemeral/read-only depending on the execution environment, so persist variations by committing generated Markdown files or later adding durable storage.
