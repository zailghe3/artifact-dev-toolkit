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


## Artifact storage

The app reads and writes artifacts through an `ArtifactRepository` interface. Local development uses `FileArtifactRepository`, which stores Markdown files under `artifacts/` and writes variations under `artifacts/variations/`.

A `GitHubArtifactRepository` placeholder is included to make a future GitHub API-backed implementation explicit. Do not commit GitHub tokens, API keys, or other credentials to this repository. Future GitHub-backed storage must load credentials only from environment variables, platform secrets, or a managed secrets service. The repository layer rejects variation content that looks like a private key, token, API key, password, or secret before persisting it.

To select a future repository backend, use environment configuration such as `ARTIFACT_REPOSITORY=github`; keep any corresponding credentials out of Git and in deployment secrets only.

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

`Publish to Cloudflare` runs after commits land on `main` and can also be started manually from the Actions tab. It builds the OpenNext Cloudflare worker and publishes it with Wrangler. Wrangler reads Cloudflare credentials from environment variables, so do not hard-code API tokens, account IDs, or other credentials in workflow files, `wrangler.jsonc`, package scripts, or source code.

#### GitHub Actions secrets

Before enabling the GitHub Actions production deployment, add these repository or environment secrets in GitHub:

1. Open the repository on GitHub.
2. Go to **Settings → Secrets and variables → Actions**.
3. Add a secret named `CLOUDFLARE_API_TOKEN` with a Cloudflare API token that can deploy the configured worker.
4. Add a secret named `CLOUDFLARE_ACCOUNT_ID` with the target Cloudflare account ID.

The deployment workflow passes those secrets to Wrangler as environment variables only for the publish step:

```yaml
env:
  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
  CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

#### Cloudflare Pages variables

If you deploy through Cloudflare Pages instead of GitHub Actions, configure the same values in Cloudflare rather than committing them to the repository:

1. Open the project in the Cloudflare dashboard.
2. Go to **Workers & Pages → your Pages project → Settings → Environment variables**.
3. Add `CLOUDFLARE_API_TOKEN` as a secret environment variable for the environments that run Wrangler deployments.
4. Add `CLOUDFLARE_ACCOUNT_ID` as an environment variable for the same environments.

The deployed worker is configured in `wrangler.jsonc`, which intentionally contains no API token.

Local file writes for variation creation work in local development. On hosted deployments, runtime filesystem writes are ephemeral/read-only depending on the execution environment, so persist variations by committing generated Markdown files or later adding durable storage.
