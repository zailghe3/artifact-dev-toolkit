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

Use Node.js 22 (`.nvmrc` / `.node-version`) with npm 10.9.7 (`package.json` `packageManager`) and install dependencies reproducibly.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```


## Artifact storage

The app reads and writes artifacts through an `ArtifactRepository` interface. Local development uses `FileArtifactRepository`, which stores Markdown files under `artifacts/` and writes variations under `artifacts/variations/`.

A `GitHubArtifactRepository` placeholder is included to make a future GitHub API-backed implementation explicit. Do not commit GitHub tokens, API keys, or other credentials to this repository. Future GitHub-backed storage must load credentials only from environment variables, platform secrets, or a managed secrets service. The repository layer rejects variation content that looks like a private key, token, API key, password, or secret before persisting it.

To select a future repository backend, use environment configuration such as `ARTIFACT_REPOSITORY=github`; keep any corresponding credentials out of Git and in deployment secrets only.

## Development workflow

Feature work uses a stable Feature ID convention documented in `docs/development-workflow.md`. A Feature ID such as `DEV-001` identifies the product capability independently from the GitHub issue number, while the GitHub issue remains the canonical work-item tracker.

For programmatic feature requests, discuss and agree the product definition with ChatGPT, have ChatGPT produce one complete Codex prompt, and paste that prompt into Codex. Codex should follow `docs/codex-create-feature-request.md`: create `feature-request/<request-id>`, write `requests/features/pending/<request-id>.json`, validate and dry-run render the request, open a non-draft pull request, and stop without implementing the feature or creating the issue directly. The post-merge workflow creates the canonical GitHub issue after the request reaches `main`. A reusable ChatGPT-populated prompt template is available at `docs/templates/codex-create-feature-request-prompt.md`.

## GitHub automation

This repository includes GitHub Actions for pull request validation, optional auto-merge, explicit post-merge deployment dispatch, and Cloudflare publication.

### Pull request checks

`CI` runs on pull requests and pushes to `main`:

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npm run build:worker
```

### Auto-merge

To let GitHub merge a pull request after required checks pass:

1. Enable **Allow auto-merge** in the repository settings.
2. Configure branch protection on `main` so the `verify-main / verify` and `verify-pr / verify` checks are required.
3. Open a non-draft pull request from the same repository as the repository owner reported by `github.repository_owner`. Codex-created pull requests qualify when Codex acts through that GitHub identity.

The `Apply label and enable auto-merge` workflow applies the `auto-merge` label and calls `gh pr merge --auto --squash --delete-branch`, so GitHub performs the merge only after required checks and branch protection rules are satisfied. The workflow does not trust labels supplied by a pull request author as authorization: it first confirms that the pull request author matches `github.repository_owner`, that the branch comes from this repository rather than a fork, and that the complete changed-file list contains no sensitive CI/CD or execution-sensitive paths. Sensitive changes under `.github/workflows/**`, `.github/actions/**`, `scripts/**`, `package.json`, `package-lock.json`, `wrangler.jsonc`, or `open-next.config.*` are skipped for manual review and manual merging. It intentionally uses the repository-provided `GITHUB_TOKEN` because that token is ephemeral and repository-scoped. `AUTO_MERGE_TOKEN` or other personal access token secrets are no longer required for auto-merge; after this change is merged, any unused `AUTO_MERGE_TOKEN` repository secret can be deleted manually from **Settings → Secrets and variables → Actions**.

After GitHub successfully merges a pull request into `main`, `Dispatch Cloudflare deployment` explicitly starts the deployment workflow on `main` with `gh workflow run deploy-cloudflare.yml --ref main`. This replaces reliance on token-generated push events to cascade into deployment. The sequence is:

```text
PR opened
→ auto-merge enabled with GITHUB_TOKEN
→ checks pass
→ PR merges into main
→ post-merge dispatcher explicitly starts Cloudflare deployment
→ deployment workflow builds and publishes current main
```

### Cloudflare publication

`Publish to Cloudflare` is the single source of truth for the Cloudflare build and deployment. It is started automatically by the post-merge dispatcher after a pull request is merged into `main`, and it can also be started manually from the Actions tab with `workflow_dispatch`. Its direct `push` trigger is intentionally disabled to avoid duplicate deployments from both a merge push and an explicit dispatch.

Direct commits to `main` should not be the normal path because repository rules require pull requests. If an exceptional direct commit reaches `main`, start `Publish to Cloudflare` manually from the Actions tab to deploy that commit. Do not weaken branch protection or enable direct pushes for deployment.

`Publish to Cloudflare` builds the OpenNext Cloudflare worker and publishes it with Wrangler. Wrangler reads Cloudflare credentials from environment variables, so do not hard-code API tokens, account IDs, or other credentials in workflow files, `wrangler.jsonc`, package scripts, or source code.

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
