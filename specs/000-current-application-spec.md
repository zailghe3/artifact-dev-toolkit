# Artifact Library — Current Application Specification

**Document status:** Baseline specification of the implemented application  
**Application version:** 0.1.0  
**Scope:** Current behaviour only; this document is not a roadmap  
**Last updated:** 2026-07-10

## 1. Purpose

Artifact Library is a fast, local-first web application for finding, reading, copying, and creating variations of reusable consulting and development assets.

The application treats each reusable asset as an **artifact**. Current supported artifact types are:

- prompt
- agent
- snippet
- template
- app idea

The primary use case is rapid retrieval during day-to-day work. A user should be able to search for an artifact, open it, copy its content, and paste it into another tool with minimal friction.

## 2. Current product goals

The implemented application aims to:

1. Provide a single searchable catalogue of reusable artifacts.
2. Store artifacts in a portable, human-readable Markdown format.
3. Support quick copying of artifact content.
4. Allow an existing artifact to be forked into a draft variation.
5. Keep storage access behind a repository abstraction so another backend can be introduced later.
6. Run locally as a Next.js application and deploy as a Cloudflare Worker through OpenNext.

## 3. Users and access

The current application has a single-user, trusted-user model.

There is currently:

- no authentication;
- no authorisation or role model;
- no user profile;
- no tenant separation;
- no sharing or collaboration workflow.

Anyone who can access the deployed URL can view the artifacts exposed by that deployment.

## 4. Artifact data model

Artifacts are stored as Markdown files with YAML frontmatter under the `artifacts/` directory and its subdirectories.

### 4.1 Required frontmatter

Each artifact must contain:

```yaml
id: unique-artifact-id
title: Human-readable title
type: prompt | agent | snippet | template | app-idea
status: production | draft | archived
tags: []
aliases: []
```

### 4.2 Optional frontmatter

A variation may additionally contain:

```yaml
sourceId: source-artifact-id
createdAt: ISO-8601 timestamp
```

### 4.3 Body

The Markdown content following the frontmatter is the artifact body.

The body is:

- included in search;
- rendered as HTML on the artifact detail page;
- copied without the YAML frontmatter;
- used as the starting content when creating a variation.

### 4.4 Validation

Artifact metadata is validated at runtime.

An artifact is valid only when:

- `id` is a non-empty string;
- `title` is a non-empty string;
- `type` is one of the supported artifact types;
- `status` is one of the supported statuses;
- `tags` and `aliases` are arrays of strings.

Invalid artifact metadata causes artifact loading to fail rather than being silently ignored.

## 5. Functional requirements

### 5.1 Library home page

The home page shall:

1. Load all available artifacts from the configured artifact repository.
2. Display the total number of artifacts.
3. Display the number of artifacts with `production` status.
4. Present a search field with focus on initial page load.
5. Display the number of artifacts matching the current search.
6. Display matching artifacts as selectable cards.
7. Sort artifacts alphabetically by title before displaying them.

Each artifact card shall display:

- title;
- short excerpt derived from the first 180 characters of the body;
- status;
- type;
- tags.

Selecting a card shall open the artifact detail page.

### 5.2 Search

Search shall operate in the browser over the artifacts loaded with the page.

The search shall match against the currently implemented searchable fields:

- title;
- type;
- status;
- tags;
- aliases;
- body.

An empty search query shall return all artifacts.

The application currently provides text search only. It does not provide semantic search, ranking by meaning, filters, saved searches, or advanced query syntax.

### 5.3 Artifact detail page

The artifact detail page shall:

1. Resolve an artifact by its `id`.
2. return the standard not-found page when no artifact matches the requested ID;
3. display the artifact type;
4. display the artifact title;
5. display the status;
6. display all tags;
7. display aliases when present;
8. render the Markdown body as HTML;
9. provide navigation back to the library;
10. provide a copy action;
11. provide the variation editor.

Artifact detail routes use the form:

```text
/artifacts/{artifact-id}
```

Known artifact IDs are included in the application's generated route parameters during build.

### 5.4 Copy artifact

The detail page shall provide a one-click copy action.

The copied value shall be the Markdown body only. It shall not include YAML frontmatter or generated HTML.

### 5.5 Create variation

The detail page shall provide a variation form pre-populated with:

- a title formed from the source title followed by `Variation`;
- the complete body of the source artifact.

The user may edit both values before saving.

On save, the application shall:

1. submit the variation through the artifact variation API;
2. reject the request when the source artifact does not exist;
3. reject invalid input;
4. scan the title and body for supported secret-like patterns;
5. create a new Markdown artifact when validation succeeds;
6. assign the variation `draft` status;
7. retain the source artifact type;
8. retain the source aliases;
9. retain the source tags and add the `variation` tag;
10. set `sourceId` to the original artifact ID;
11. set `createdAt` to the current ISO-8601 timestamp;
12. generate a unique ID from the title and timestamp;
13. save the file under `artifacts/variations/`;
14. redirect the user to the newly created artifact.

A generated variation ID follows the current pattern:

```text
{slugified-title}-{YYYY-MM-DD}-{HHMMSS}
```

The title slug is lowercase, uses hyphens for non-alphanumeric sequences, and is limited to 80 characters before the timestamp is appended.

### 5.6 Secret detection

Before writing a variation, the application shall refuse content that appears to contain certain secrets, including supported patterns for:

- private keys;
- values assigned to fields named API key, token, secret, or password;
- GitHub tokens;
- OpenAI-style secret keys.

This is a safety check, not a complete secret-scanning or data-loss-prevention system.

## 6. Storage behaviour

### 6.1 Repository abstraction

All artifact reads and variation writes shall use the `ArtifactRepository` interface.

The interface currently provides:

```ts
list(): Promise<Artifact[]>
findById(id: string): Promise<Artifact | undefined>
createVariation(input: CreateVariationInput): Promise<string>
```

### 6.2 File repository

The default backend is `FileArtifactRepository`.

It shall:

- recursively discover `.md` files beneath `artifacts/`;
- parse YAML frontmatter and Markdown bodies;
- validate metadata;
- return artifacts sorted by title;
- create variation files beneath `artifacts/variations/`.

### 6.3 GitHub repository placeholder

A `GitHubArtifactRepository` class exists but is not implemented.

Setting:

```text
ARTIFACT_REPOSITORY=github
```

currently selects that placeholder and causes repository operations to fail with an explicit not-implemented error.

No current application requirement depends on GitHub-backed runtime storage.

### 6.4 Hosted deployment limitation

Variation creation is fully functional when the application runs in an environment with a persistent, writable project filesystem.

On Cloudflare Workers or similar hosted serverless environments, runtime filesystem writes may be unavailable, read-only, or ephemeral. Therefore, variations created through the deployed application are not currently guaranteed to persist.

Persistent hosted variation storage is outside the scope of the current implementation.

## 7. Seed content

The repository currently includes example prompt artifacts covering:

- board updates;
- slide narrative creation;
- Copilot coding requests;
- meeting summaries.

These serve both as usable initial content and as examples of the artifact format.

## 8. User experience and presentation

The current interface shall:

- be responsive across desktop and mobile screen widths;
- prioritise search and quick retrieval;
- use a card-based library layout;
- use badges to distinguish status, type, and tags;
- use a constrained central content width;
- provide visible hover and focus states;
- use Tailwind CSS for styling.

Accessibility is supported through standard HTML controls and focus styling, but the current application has no documented WCAG conformance target or automated accessibility test suite.

## 9. Technical architecture

### 9.1 Application stack

The current application uses:

- Next.js 15;
- React 19;
- TypeScript;
- Tailwind CSS;
- Zod for validation;
- gray-matter for Markdown frontmatter parsing;
- remark and remark-html for Markdown rendering;
- OpenNext for Cloudflare;
- Wrangler for Cloudflare deployment.

### 9.2 Rendering model

- The home page is a server component that loads artifacts before rendering.
- Interactive search is implemented as a client component.
- Artifact detail pages are server-rendered and use generated static parameters for known artifacts.
- Copy and variation controls are client components.
- Variation creation is handled through an HTTP API route.

### 9.3 Security assumptions

The current application assumes that artifact files are trusted repository content.

The current implementation does not include:

- authentication;
- per-user access controls;
- content approval;
- malware scanning;
- comprehensive secret scanning;
- rate limiting;
- audit logs;
- encryption managed by the application.

Markdown is transformed to HTML for display. Any future support for untrusted user-generated content must explicitly review sanitisation requirements.

## 10. Development and quality checks

The application shall support the following local commands:

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

The repository's continuous integration workflow runs installation, type checking, and production build checks on pull requests and pushes to `main`.

## 11. Deployment

The application is configured to build and deploy as a Cloudflare Worker using OpenNext.

Relevant commands include:

```bash
npm run build:worker
npm run preview
npm run deploy
npm run upload
```

Production deployment through GitHub Actions requires deployment credentials to be supplied as secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Credentials shall not be committed to source control.

The repository may also be deployed through Cloudflare's Git integration, but only one automatic deployment path should normally be active to avoid duplicate builds and deployments.

## 12. Current exclusions

The following capabilities are not part of the current application:

- creating a brand-new base artifact through the UI;
- editing or deleting an existing artifact;
- promoting a variation to production;
- comparing or merging variations;
- durable variation writes on Cloudflare Workers;
- GitHub-backed artifact reads or writes;
- authentication and private-user access;
- multiple users or collaboration;
- favourites, recent items, or usage history;
- filtering or sorting controls in the UI;
- semantic or AI-assisted search;
- import or export workflows;
- artifact version history within the application;
- agents that execute actions;
- API integrations with Copilot, ChatGPT, Outlook, Teams, or PowerPoint;
- automated tests beyond type checking and production build validation.

## 13. Baseline acceptance criteria

The current application is considered operational when:

1. dependencies install successfully;
2. TypeScript validation succeeds;
3. a production Next.js build succeeds;
4. valid Markdown artifacts are loaded from `artifacts/`;
5. the home page displays artifact and production counts;
6. search returns matching artifacts across the implemented fields;
7. artifact cards open their detail pages;
8. Markdown bodies render on detail pages;
9. copy places the source Markdown body on the clipboard;
10. local variation creation writes a valid Markdown file and opens the new artifact;
11. secret-like variation content is rejected;
12. the OpenNext Cloudflare worker build succeeds with the supported deployment configuration.

## 14. Document maintenance

This file describes the implemented baseline as of its stated update date.

When behaviour changes, this specification should be updated in the same pull request as the implementation. Future product ideas should be documented separately rather than added here as if already implemented.
