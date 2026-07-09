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

## Deployment to Vercel

1. Push this repository to GitHub.
2. Import the repository in Vercel.
3. Use the default Next.js framework settings.
4. Deploy.

Local file writes for variation creation work in local development. On serverless Vercel deployments, runtime filesystem writes are ephemeral/read-only depending on the execution environment, so persist variations by committing generated Markdown files or later adding durable storage.
