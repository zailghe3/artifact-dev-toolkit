# Artifact Library — Current Application Specification

**Document status:** Baseline specification of the implemented application  
**Application version:** 0.1.0  
**Scope:** Current behaviour only; this document is not a roadmap  
**Last updated:** 2026-07-13

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

The current application requires GitHub sign-in before a visitor can access artifact metadata, artifact bodies, library pages, detail pages, or protected artifact APIs.

The application currently has:

- GitHub OAuth sign-in as the only identity provider;
- server-side session tracking in Cloudflare D1 keyed by HMACs of strongly random session identifiers;
- an `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` `__Host-` session cookie with no `Domain` attribute;
- sign-out behaviour that revokes the D1 session record and expires the browser cookie;
- no repository authorisation check beyond successful GitHub authentication;
- no role model;
- no user profile or account settings;
- no tenant separation;
- no sharing or collaboration workflow.

Unauthenticated visitors are redirected to `/sign-in` and must complete GitHub authentication before protected application content is rendered.

## 4. Artifact data model

Artifacts are stored as Markdown files with YAML frontmatter under the `artifacts/` directory and its subdirectories. DATA-001 also defines the compatible external private repository contract documented in `docs/external-artifact-repository-contract.md`.

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

1. Require an authenticated GitHub session before loading artifacts from the configured artifact repository.
2. Load all available artifacts from the configured artifact repository.
3. Display the total number of artifacts.
4. Display the number of artifacts with `production` status.
5. Present a search field with focus on initial page load.
6. Display the number of artifacts matching the current search.
7. Display matching artifacts as selectable cards.
8. Sort artifacts alphabetically by title before displaying them.
9. Display the signed-in GitHub login and provide a sign-out action.

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

1. Require an authenticated GitHub session before resolving or rendering artifact data.
2. Resolve an artifact by its `id`.
3. return the standard not-found page when no artifact matches the requested ID;
4. display the artifact type;
5. display the artifact title;
6. display the status;
7. display all tags;
8. display aliases when present;
9. render the Markdown body as HTML;
10. provide navigation back to the library;
11. provide a copy action;
12. provide the variation editor;
13. display the signed-in GitHub login and provide a sign-out action.

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

### 5.7 Authentication

The sign-in page at `/sign-in` explains that GitHub authentication is required and provides a Sign in with GitHub action. It supports a relative `returnTo` URL so successful authentication returns users to their intended protected page.

The GitHub OAuth callback at `/auth/github/callback` validates the OAuth `state` value stored in an `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` `__Host-` cookie before exchanging the authorization code server-side. OAuth state cookies are short-lived, single-use, compared without early-exit equality, and deleted during callback processing including denied authorization outcomes. After a successful callback, the application fetches the authenticated GitHub user through GitHub server-side APIs, validates the stable numeric user ID and login, creates a strongly random server-side session identifier, stores only that identifier in the session cookie, and redirects to the safe return URL. The OAuth access token is discarded after the identity fetch; it is not retained in the session database or exposed to browser JavaScript. Denied authorization, missing codes, invalid state, token-exchange failures, and identity-fetch failures redirect back to sign-in with a clear non-secret-bearing error.

The sign-out endpoint at `/sign-out` changes state only for POST requests. POST sign-out revokes the server-side D1 session record, clears the session cookie, and redirects to a safe local destination. GET sign-out does not invalidate the session and only redirects to a safe local destination. Sign-out is idempotent and does not disclose whether an arbitrary session identifier existed. Expired, revoked, malformed, missing, or unknown sessions are rejected and protected pages redirect back to sign-in without rendering artifact content.

Protected artifact APIs return private, no-store `401` JSON responses for unauthenticated callers before artifact loading, repository access, or variation creation occurs. Authenticated protected API responses, OAuth callback responses, and sign-out redirects also use private/no-store cache controls.

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

### 6.3 External artifact repository contract

The stable storage contract for a dedicated private artifact repository is documented in `docs/external-artifact-repository-contract.md`.

That contract specifies:

- authoritative branch `main`;
- configurable artifact root path, defaulting to `artifacts/`;
- supported top-level directories `prompts/`, `agents/`, `snippets/`, `templates/`, `app-ideas/`, and `variations/`;
- recursive nested Markdown artifact support inside those directories;
- globally unique artifact IDs across the complete artifact root;
- required frontmatter fields `id`, `title`, `type`, `status`, `tags`, and `aliases`;
- optional `sourceId` and `createdAt` variation metadata;
- the same supported artifact types and statuses used by the application.

A validation command exists for complete checkouts of that external repository:

```bash
npm run artifacts:validate -- ../private-artifact-storage
npm run artifacts:validate -- ../private-artifact-storage --root custom-root
```

The validator is independent of GitHub authentication and Cloudflare runtime behaviour. It reports file-specific errors for missing roots or directories, malformed or missing YAML front matter, missing required fields, unsupported values, duplicate IDs, and Markdown files placed outside the supported top-level directories.

Representative valid and invalid fixtures exist under `test-fixtures/external-artifact-repository/`, and examples for every supported artifact type exist under `docs/examples/external-artifact-repository/`.

### 6.4 GitHub repository placeholder

A `GitHubArtifactRepository` class exists but is not implemented.

Setting:

```text
ARTIFACT_REPOSITORY=github
```

currently selects that placeholder and causes repository operations to fail with an explicit not-implemented error.

No current application requirement depends on GitHub-backed runtime storage.

### 6.5 Hosted deployment limitation

Variation creation is fully functional when the application runs in an environment with a persistent, writable project filesystem.

On Cloudflare Workers or similar hosted serverless environments, runtime filesystem writes may be unavailable, read-only, or ephemeral. Therefore, variations created through the deployed application are not currently guaranteed to persist.

Persistent hosted variation storage is outside the scope of the current implementation.

## 7. Seed content

The application repository currently includes example prompt artifacts covering:

- board updates;
- slide narrative creation;
- Copilot coding requests;
- meeting summaries.

These serve both as usable initial content and as examples of the artifact format. Under the external repository contract, these samples should be migrated to `artifacts/prompts/` in the storage repository because each sample currently has `type: prompt`.

## 8. User experience and presentation

The current interface shall:

- be responsive across desktop and mobile screen widths;
- prioritise search and quick retrieval;
- use a card-based library layout;
- use badges to distinguish status, type, and tags;
- use a constrained central content width;
- provide visible hover and focus states;
- use Tailwind CSS for styling;
- support application-wide dark and light themes, with dark mode used by default.

The active theme is applied on the root document element and initialised before paint from browser storage. The stable storage key is `artifact-library-theme`. When the stored value is absent or invalid, the application defaults to dark mode rather than following the operating-system colour-scheme preference. A saved light or dark preference takes precedence on later visits.

A compact theme toggle is available in the top-right area of the shared page chrome on the library page and artifact detail pages. Switching themes takes effect immediately without a page reload, persists the selected value in browser storage, exposes an accessible label for the next action, and remains keyboard operable with visible focus styling.

Dark mode uses orange as the primary accent colour for theme-specific highlights, focus rings, hover states, primary controls, and type badges. Light mode retains the existing blue/sky primary accent colour. Cards, text, links, buttons, forms, badges, backgrounds, borders, selection states, artifact search, artifact details, copy controls, and variation forms are styled to remain readable and usable in both themes.

Accessibility is supported through standard HTML controls and focus styling, but the current application has no documented WCAG conformance target or automated accessibility test suite.

## 9. Technical architecture

### 9.1 Application stack

The current application uses:

- Next.js 16.2.10;
- React 19.2.7;
- TypeScript 5.9.3 with ESLint 9.39.5, `eslint-config-next` 16.2.10, and `typescript-eslint` 8.63.0;
- Tailwind CSS 4.3.2 with `@tailwindcss/postcss` 4.3.2 and PostCSS 8.5.18;
- Zod for validation;
- gray-matter for Markdown frontmatter parsing;
- remark and remark-html for Markdown rendering;
- OpenNext for Cloudflare 1.20.1;
- Wrangler 4.110.0 for Cloudflare deployment.

Direct dependency declarations are maintained as the tested lower bounds for the package versions validated by this repository. DEV-005 records the inspected dependency outcomes, removal decisions, audit status, and compatibility constraints in `docs/dev-005-dependency-refresh.md`. DEV-006 documents the deterministic maintenance model in `docs/dependency-toolchain-maintenance.md`, including Dependabot compatibility-domain grouping, intentional major-upgrade handling, exception recording, and currentness verification. DEV-007 documents the TypeScript 7 assessment in `docs/dev-007-typescript-7-assessment.md`; the migration is deferred because the required `typescript-eslint` 8.63.0 parser/compiler-API stack declares TypeScript support only through `<6.1.0`, so the application remains on TypeScript 5.9.3 until that integration supports TypeScript 7 and the full validation matrix is reassessed.

### 9.2 Rendering model

- The home page is a server component that loads artifacts before rendering.
- Interactive search is implemented as a client component.
- Artifact detail pages are server-rendered and use generated static parameters for known artifacts.
- Copy and variation controls are client components.
- Variation creation is handled through an HTTP API route.

### 9.3 Security assumptions

The current application assumes that artifact files are trusted repository content.

The current implementation does not include:

- per-user repository access controls;
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
npm run toolchain:validate
npm run typecheck
npm run build
npm run build:worker
npm run preview
npm run deploy
```

Pull-request validation includes an automatic package-lock repair stage for trusted same-repository PR branches with lockfile-relevant changes, including package metadata, lockfile, Node/npm version files, and dependency-management configuration. The PR lifecycle does not duplicate lockfile repair logic; it calls the existing `Repair package lock` workflow with the PR head branch as `target_branch` for branches in the workflow's permitted repair scope. That called workflow remains the single implementation for canonical Node.js/npm setup, regenerating `package-lock.json`, saving the regenerated lockfile outside the workspace, validating with a clean install and the full suite, discarding validation side effects, restoring only the saved lockfile, and committing only `package-lock.json` when it changed. The reusable repair workflow reports whether it published a repair so PR validation can continue immediately for no-op regeneration, or skip old-head verification and let the subsequent `synchronize` run validate the repaired head commit. Fork PRs, untrusted external branches, and same-repository branches outside the existing repair scope never receive write-capable repair automation. Dependabot and other bot PRs are handled only when their branches are same-repository branches writable by the repository token; otherwise maintainers use the manual recovery workflow and the PR receives the normal lockfile-validation failure.

The manual package-lock repair workflow preserves that same canonical toolchain: it regenerates `package-lock.json` with Node.js from `.nvmrc` and the exact npm version from `package.json#packageManager`, saves the regenerated lockfile outside the repository workspace, runs the full validation suite, then discards validation side effects before restoring only `package-lock.json`. Validation tools are allowed to modify framework-generated tracked files temporarily, but those files are never committed by the repair workflow. Repairs to `main` are delivered through the deterministic `repair/regenerate-package-lock` branch and a reused or newly created pull request because repository rules prohibit direct pushes to `main`; repairs to permitted working branches such as `codex/*`, `repair/*`, and `dependabot/*` are committed directly to those branches. The repository uses Node.js 24 LTS from `.nvmrc`/`.node-version`, npm 11.4.2 from `package.json` `packageManager`, and Node 24-aligned `@types/node` declarations. The React type declarations track React/React DOM 19.2.7, and the linting stack uses Next.js flat ESLint configuration with the `typescript-eslint` package required by `eslint-config-next`. GitHub Actions workflows select Node.js with `node-version-file: .nvmrc`; third-party actions remain pinned to full immutable commit SHAs with adjacent comments identifying their release tags, currently `actions/checkout@v7.0.0` and `actions/setup-node@v6.4.0` where those actions are used. The `npm run toolchain:validate` command checks agreement between the canonical version files, package metadata, lockfile metadata, GitHub Actions workflows, GitHub Action full-SHA pins and release comments, and Codex/documentation templates. The `npm run maintenance:report` command provides deterministic read-only reporting for outdated direct dependencies, deprecated direct packages, unsupported runtime versions, canonical toolchain disagreement, lockfile/package-manager inconsistency, unpinned action references, and stale action release comments. The repository's continuous integration workflow runs installation, toolchain validation, type checking, and production build checks on pull requests and pushes to `main`. A scheduled and manually dispatchable dependency maintenance report workflow runs with `contents: read` permissions only, writes findings to the GitHub Actions summary, and never modifies repository contents or creates noisy issues.

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
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `SESSION_SECRET`

Credentials and OAuth/session secrets shall not be committed to source control. `SESSION_SECRET` must be at least 32 characters long. The GitHub OAuth App callback URL must point to `/auth/github/callback` on the deployed application host. Deployments must bind the Cloudflare D1 database `AUTH_SESSIONS_DB`; `wrangler.jsonc` records the binding name and database name, and operators replace the placeholder database ID with the ID returned by `wrangler d1 create fpo-adt-auth-sessions`.

The repository may also be deployed through Cloudflare's Git integration, but only one automatic deployment path should normally be active to avoid duplicate builds and deployments.

## 12. Current exclusions

The following capabilities are not part of the current application:

- creating a brand-new base artifact through the UI;
- editing or deleting an existing artifact;
- promoting a variation to production;
- comparing or merging variations;
- durable variation writes on Cloudflare Workers;
- GitHub-backed artifact reads or writes;
- multiple users or collaboration;
- favourites, recent items, or usage history;
- filtering or sorting controls in the UI;
- semantic or AI-assisted search;
- import or export workflows;
- artifact version history within the application;
- agents that execute actions;
- API integrations with Copilot, ChatGPT, Outlook, Teams, or PowerPoint;
- GitHub-backed artifact reads or writes;
- automated tests beyond the currently included Node test suite, type checking, and production build validation.

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
12. unauthenticated visitors are redirected away from protected pages and receive `401` responses from protected APIs;
13. GitHub OAuth callbacks validate state before creating a session;
14. sign-out invalidates the current session;
15. the OpenNext Cloudflare worker build succeeds with the supported deployment configuration.

## 14. Document maintenance

This file describes the implemented baseline as of its stated update date.

When behaviour changes, this specification should be updated in the same pull request as the implementation. Future product ideas should be documented separately rather than added here as if already implemented.

## 15. Deployment identity footer

Every page renders a visually secondary site footer containing deployment identity. When production deployment metadata is available at build time, the footer displays the deployment timestamp, abbreviated source commit SHA and, when resolved, the pull request number associated with the deployed commit.

The deployment timestamp is stored as a canonical UTC ISO-8601 value and is rendered in the browser's local timezone using semantic `<time>` markup. The canonical UTC value remains available through the `dateTime` attribute and title. The abbreviated commit links to the repository commit while preserving the full SHA in accessible metadata. The pull request element is optional and is omitted when no associated pull request is resolved.

Local development and builds without generated deployment metadata display `Development build`. Deployment metadata is supplied at build time by the production workflow and is validated through `lib/deployment-metadata.ts`; generated deployment-specific data is not committed to the repository.
