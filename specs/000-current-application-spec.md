# Artifact Library — Current Application Specification

**Document status:** Baseline specification of the implemented application  
**Application version:** 0.1.0  
**Scope:** Current features only; this document is not a roadmap  
**Last updated:** 2026-08-04

## 1. Authentication and repository access

### 1.1 GitHub sign-in

* Users sign in through a GitHub App OAuth flow.
* OAuth requests use a single-use state value and S256 PKCE.
* A safe relative return path sends the user back to the originally requested application page.
* GitHub identity is validated using the numeric GitHub user ID and login.

### 1.2 Server-side sessions

* Authenticated sessions are stored in Cloudflare D1.
* The browser stores a strongly random session identifier in an HTTP-only session cookie.
* GitHub user access tokens retained for repository revalidation are encrypted with AES-GCM.
* Session expiry does not extend beyond the corresponding GitHub user token expiry.

### 1.3 Repository authorisation

* Access is restricted to the configured artifact repository.
* Authorisation verifies:

  * the signed-in GitHub user’s access;
  * the GitHub App installation’s access;
  * the configured repository owner and name;
  * the stored immutable repository and installation IDs;
  * an optional login allowlist.
* Stored repository authorisation is periodically revalidated.
* Repository access contexts provide capability-scoped installation credentials for reading, writing, and pull-request operations.

### 1.4 Protected application surfaces

* Library pages, artifact pages, diagnostics, and artifact APIs require authentication and repository authorisation.
* Unauthenticated browser requests are redirected to sign-in.
* Repository-authorisation failures are presented on an access-denied page with a safe reason.
* Protected API responses use private, no-store cache headers.
* Signing out revokes the server-side session and clears the session cookie.

## 2. Artifact catalogue and search

### 2.1 Catalogue loading

* The library loads a validated collection of artifacts after repository access is established.
* Artifacts are sorted alphabetically by title.
* The library displays:

  * the total artifact count;
  * the production artifact count;
  * the current catalogue refresh state;
  * the last successful refresh time.

### 2.2 Artifact cards

Each artifact card displays:

* title;
* an excerpt derived from the first 180 body characters;
* status;
* type;
* tags.

Selecting a card opens its artifact detail page.

Cards also provide revision-aware delete controls. Confirmation deletes draft and archived artifacts directly or creates a production deletion proposal; incomplete proposals retain the card and expose a validated recovery-branch link.

### 2.3 Search

* Search runs interactively in the browser over the loaded catalogue.
* The search input receives initial focus.
* Search is case-insensitive.
* Multiple search terms must all match the combined searchable content.
* Search covers:

  * title;
  * type;
  * status;
  * tags;
  * aliases;
  * Markdown body.
* The matching artifact count updates with the search.
* An empty query returns the complete catalogue.
* The protected artifacts API also supports query-based search.

## 3. Artifact detail and copying

### 3.1 Detail resolution

* Artifact detail pages use `/artifacts/{artifact-id}` routes.
* Detail pages are dynamically resolved.
* An artifact is resolved together with its current repository file SHA and catalogue state.
* A successfully completed lookup with no matching artifact returns the application’s not-found page.

### 3.2 Artifact presentation

The detail page displays:

* artifact type;
* title;
* status;
* tags;
* aliases;
* rendered Markdown body;
* catalogue freshness information;
* navigation back to the library;
* the signed-in login and sign-out control.

### 3.3 Copying

* The Copy body control writes the source Markdown body to the clipboard.
* YAML frontmatter and rendered HTML are excluded.
* The control displays temporary success feedback after copying.

## 4. Draft variation creation

### 4.1 Variation editor

* Every artifact detail page provides a variation editor.
* The initial variation title is the source title followed by `Variation`.
* The initial body is the complete source artifact body.
* The user can edit the title and body.

### 4.2 Variation preview

* A protected preview renders the proposed Markdown body.
* Preview displays the generated metadata, including:

  * title;
  * draft status;
  * source relationship;
  * tags;
  * aliases.
* Previewing performs no repository write.

### 4.3 Variation metadata

A saved variation:

* receives a generated globally unique ID;
* receives `draft` status;
* preserves the source artifact type;
* preserves source aliases;
* preserves source tags and adds the `variation` tag;
* records the source artifact ID in `sourceId`;
* records an ISO-8601 creation timestamp in `createdAt`.

The generated ID contains:

* a slug derived from the title;
* the creation date;
* the creation time;
* a cryptographically random eight-character hexadecimal suffix.

### 4.4 Variation persistence

* GitHub-backed deployments save variations beneath the configured `variations` directory.
* The write creates an attributable GitHub commit.
* Successful persistence invalidates the current catalogue cache.
* The result includes a link to the new artifact and a validated GitHub commit link.
* Local file-backed operation can write variation Markdown to the local variations directory.

## 5. Artifact lifecycle editing and proposals

### 5.1 Creation and shared editor

* The library provides a **Create artifact** action at `/artifacts/new` and a protected editor at `/artifacts/{id}/edit`.
* New base artifacts are drafts. Their suggested stable ID remains editable until the first successful save, after which ID and type are immutable and duplicate creation is prevented.
* The shared preview covers creation and editing without writing. Title, tags, aliases, and body are editable; ID, type, status, source relationship, and creation timestamp are immutable for stored artifacts.
* Draft and archived updates are direct writes. The editor validates and adopts each returned file SHA, so subsequent previews, saves, and deletion use the exact active revision.

### 5.2 Proposal editor

* Production artifact detail pages provide a change-proposal editor.
* The editor is populated with the current:

  * title;
  * tags;
  * aliases;
  * Markdown body;
  * repository file SHA.
* The user can modify the title, tags, aliases, and body.

### 5.3 Proposal preview

* The proposed metadata and rendered body can be previewed before submission.
* Preview requires an authenticated and authorised request.
* The source artifact must currently have production status.

### 5.4 Revision protection

* Proposal submission includes the file SHA observed when the artifact was loaded.
* The server reloads the current artifact and compares its SHA with the submitted SHA.
* A changed revision is returned as a write conflict.

### 5.5 GitHub proposal workflow

A proposal:

1. resolves the current base branch commit and tree;
2. validates the artifact’s existing repository path and file SHA;
3. creates the proposed artifact blob;
4. creates a tree based on the current base tree;
5. creates a commit with the base commit as its parent;
6. creates a deterministic branch;
7. opens a pull request against the configured base branch.

The deterministic branch format is:

`artifact-change/{artifact-id}-{first-eight-file-sha-characters}`

### 5.6 Proposal collision, deletion, and recovery handling

* Production deletion uses a deterministic `artifact-delete/{artifact-id}-{revision}` branch; direct draft and archived deletion uses the exact loaded revision and requires explicit confirmation.
* An existing branch is inspected before further mutation. Its single base parent, actual recursive tree, exact target result, every unrelated blob or gitlink, and matching open pull request are verified.
* An identical existing proposal can return its existing pull request.
* A conflicting branch returns a proposal-collision error.
* When the proposal branch exists but pull-request creation is incomplete, the response provides a validated branch recovery link.
* Proposal creation leaves the configured base branch unchanged until the pull request is merged outside the application.
* A successful direct deletion disables further editing and retains the deleted ID, validated commit link, and library navigation.

## 6. Artifact model and repository operations

### 6.1 Artifact format

Artifacts are Markdown documents with YAML frontmatter.

Required metadata:

* `id`;
* `title`;
* `type`;
* `status`;
* `tags`;
* `aliases`.

Optional metadata:

* `sourceId`;
* `createdAt`.

Supported types:

* `prompt`;
* `agent`;
* `snippet`;
* `template`;
* `app-idea`.

Supported statuses:

* `production`;
* `draft`;
* `archived`.

### 6.2 Repository structure

* Artifacts are stored beneath a configurable artifact root.
* Supported top-level directories are:

  * `prompts`;
  * `agents`;
  * `snippets`;
  * `templates`;
  * `app-ideas`;
  * `variations`.
* Nested directories beneath these locations are supported.
* Artifact IDs are globally unique across the complete artifact root.
* Artifact paths reject empty segments and path traversal.

### 6.3 Parsing and serialization

* Reads parse YAML frontmatter and Markdown through a shared canonical contract.
* Writes serialize metadata and body into canonical Markdown and parse the result again before persistence.
* Artifact excerpts are generated from normalized body text.
* Complete serialized artifacts have a one-megabyte UTF-8 size limit.
* GitHub blobs are accepted through supported base64 responses and validated before parsing.

### 6.4 Repository backends

The repository abstraction provides:

* catalogue listing;
* lookup by ID;
* revision-aware lookup;
* base-revision resolution;
* catalogue loading;
* repository validation diagnostics;
* artifact creation;
* artifact updating;
* variation creation;
* production update proposals.
* direct artifact deletion;
* production deletion proposals.

The file backend supports local artifact reading and local variation persistence.

The GitHub backend supports:

* recursive tree and blob loading;
* exact-revision catalogue loading;
* direct artifact creation;
* optimistic-concurrency updates;
* variation commits;
* production proposal branches and pull requests.
* exact deterministic-branch verification and incomplete-proposal recovery.

### 6.5 Protected artifact API

The artifact API provides:

* catalogue listing and search;
* artifact detail with `currentFileSha`;
* artifact creation;
* artifact updating.
* lifecycle preview;
* direct deletion;
* production update and deletion proposals.

Direct creation:

* chooses the canonical directory from the artifact type;
* rejects duplicate paths and duplicate IDs;
* creates an attributable commit.

Direct updating:

* requires the current file SHA;
* rejects stale revisions;
* preserves the artifact’s existing valid repository path;
* creates an attributable commit.

Successful direct writes return repository path, file SHA, commit SHA, commit URL, and repository revision information.

### 6.6 Write validation and safety

Before persistence, writes validate:

* metadata schema;
* lower-kebab-case artifact ID;
* non-empty body;
* canonical Markdown;
* artifact path;
* serialized UTF-8 size;
* global ID uniqueness;
* destination-path uniqueness;
* supported secret-like patterns.

Installation credentials are scoped separately for repository reads, repository writes, and proposal operations.

## 7. Catalogue caching and refresh

### 7.1 Revision-scoped catalogue snapshots

* GitHub-backed catalogue reads use Workers KV.
* Cached snapshots are scoped to:

  * repository identity;
  * owner and repository;
  * configured branch;
  * configured artifact root;
  * immutable repository revision.
* Cached artifacts retain their matching repository file SHAs.

### 7.2 Freshness and refresh

* Catalogue freshness defaults to five minutes.
* The configured freshness value is bounded between 30 seconds and one hour.
* A fresh catalogue is served directly from KV.
* An expired catalogue checks the current base revision.
* An unchanged repository revision refreshes catalogue timing without reloading every artifact.
* A changed revision rebuilds the validated catalogue from GitHub.

### 7.3 Cache states

The application presents these catalogue states:

* `fresh`;
* `refreshed`;
* `stale`;
* `degraded`.

A last-known-good catalogue can be served as stale content during temporary GitHub or rate-limit failures.

Fresh GitHub content can be served in degraded mode when KV is temporarily unavailable.

### 7.4 Manual controls

The library provides:

* Refresh, which forces a repository revision check;
* Full rebuild, which reloads the complete repository catalogue.

Refresh failure leaves the current catalogue in place.

### 7.5 Write invalidation

Successful direct operations invalidate the current catalogue pointer:

* artifact creation;
* artifact update;
* draft variation creation.
* artifact deletion.

Production update and deletion proposals operate on separate branches and do not invalidate the current base-branch catalogue.

API failures use typed, safe codes for validation, conflicts, permissions, availability, collisions, and incomplete proposals. The interface renders only validated local artifact paths and HTTPS GitHub commit, pull-request, and deterministic branch URLs.

## 8. Diagnostics and operational handling

### 8.1 Protected diagnostics

The application provides:

* a protected diagnostics page at `/diagnostics`;
* a protected diagnostics API.

Diagnostics access uses the stored authorised session context and is observational.

### 8.2 Diagnostic information

Diagnostics reports:

* signed-in GitHub identity;
* public repository configuration;
* authentication-secret configuration states;
* stored repository authorisation;
* best-effort live authorisation;
* GitHub App installation identifiers;
* effective Contents read permission;
* effective Contents write permission;
* effective Pull requests write permission;
* current repository revision;
* catalogue cache state;
* repository artifact validation results;
* overall operational state.

### 8.3 Repository validation diagnostics

The diagnostics scan checks:

* repository paths;
* blob SHAs;
* supported encoding;
* artifact size;
* frontmatter;
* metadata;
* body parsing;
* duplicate artifact IDs.

The returned error list is bounded and uses safe repository-relative diagnostic information.

### 8.4 Operational states

Library and detail pages map expected failures into user-facing operational states covering:

* authentication and repository authorisation;
* GitHub App installation and permissions;
* repository and branch configuration;
* rate limiting and temporary GitHub availability;
* invalid artifact repository content;
* unavailable or invalid catalogue cache state.

Operational states provide an explanation, recovery guidance, retry behavior where appropriate, and access to diagnostics.

### 8.5 Safe diagnostics behavior

* Diagnostics performs read-only capability and repository checks.
* Configuration secrets are represented as configured, missing, or invalid states.
* Responses and logs use stable categories, counts, identifiers, and timings.
* Artifact bodies, complete frontmatter, access tokens, encrypted token fields, session identifiers, cache keys, and cached contents are excluded.

## 9. Presentation and deployment identity

### 9.1 Responsive interface

* Application content uses constrained, responsive layouts.
* Artifact results use card-based presentation.
* Status, type, and tags use visual badges.
* Interactive controls provide hover and focus states.

### 9.2 Theme support

* The application supports dark and light themes.
* Dark mode is the default.
* The theme is applied before the page becomes interactive.
* The selected theme is persisted in browser storage.
* Theme changes apply immediately.
* The theme toggle identifies the next available theme through its accessible label.

### 9.3 Deployment identity

Every page includes a deployment footer.

Production deployment metadata can display:

* deployment timestamp;
* abbreviated source commit;
* link to the source commit;
* associated pull-request number and link.

Deployment time is displayed in the browser’s locale while retaining the canonical timestamp in semantic time markup.

Builds without deployment metadata display `Development build`.
