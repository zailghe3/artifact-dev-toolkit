# Artifact Library — Current Application Specification

**Document status:** Baseline specification of the implemented application  
**Application version:** 0.1.0  
**Scope:** Current features only; this document is not a roadmap  
**Last updated:** 2026-08-05

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
* The artifact workspace uses a compact page header that displays the `Artifacts` heading, the total artifact count, the production artifact count, and the `Create artifact` action.
* Search is the first primary content block after the workspace header, except when stale or degraded catalogue health requires a compact warning.
* Normal fresh or refreshed catalogue state does not occupy persistent space in the artifact workflow.

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
* Unsaved state compares canonically normalized title, tags, aliases, and trimmed body with the latest directly persisted editor snapshot. Preview, failed writes, and production proposals do not advance that snapshot; a successful direct write adopts the server-returned canonical values.

### 5.2 Proposal editor

* Production artifact detail pages provide a change-proposal editor.
* The editor is populated with the current:

  * title;
  * tags;
  * aliases;
  * Markdown body;
  * repository file SHA.
* The user can modify the title, tags, aliases, and body.

* Tags use a catalogue-backed autocomplete during creation and editing. The server derives suggestions from tag values visible in the authorised artifact catalogue and passes only that safe vocabulary to the client editor. Users can still create free-form tags; unavailable suggestion loading degrades to a short non-blocking note without disabling tag entry.
* Selected tags are displayed as compact chips with separate accessible remove buttons so a tag can be removed without making the whole chip a button. Tag changes continue through the existing policy: draft and archived saves write directly with the active file SHA, while production tag changes create reviewable update proposals and do not invalidate the base-branch catalogue.

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

* Production deletion uses a deterministic `artifact-delete/{artifact-id}-{revision}` branch; direct draft and archived deletion uses the exact loaded revision and requires explicit confirmation. Confirmation identifies the artifact title persisted at that active revision and explicitly excludes unsaved editor changes and unmerged proposal edits.
* An existing branch is inspected before further mutation. Its single base parent, actual recursive tree, exact target result, every unrelated blob or gitlink, and matching open pull request are verified.
* If the single deterministic branch-ref creation attempt returns a 409 or 422 collision, the branch ref is read once and passed through the same exact update or deletion resolver; branch creation and other uncertain mutations are never replayed.
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

The catalogue health diagnostics model presents these cache states exactly as reported:

* `fresh`;
* `stale`;
* `missing`;
* `degraded`;
* `corrupt`;
* `unavailable`.

A real catalogue result may separately report `refreshed` after a successful refresh. Missing, corrupt, and unavailable diagnostic cache states are not presented as refreshed. Catalogue health is the single authoritative display of the last successful refresh: it uses the browser locale and timezone while preserving the canonical ISO value in the time element. When no catalogue `refreshedAt` value exists, Diagnostics displays `Last successful refresh: unknown` and does not substitute diagnostics generation time. Every condition that makes the overall diagnostics state non-healthy is represented by a safe, anchored contributor explanation.

A last-known-good catalogue can be served as stale content during temporary GitHub or rate-limit failures.

Fresh GitHub content can be served in degraded mode when KV is temporarily unavailable.

### 7.4 Manual controls

Diagnostics provides the manual catalogue controls only when refresh is supported by the current infrastructure:

* Refresh, which forces a repository revision check;
* Full rebuild, which reloads the complete repository catalogue.

Controls are available for valid GitHub-backed repository configuration with repository authorisation, effective Contents read permission, and a configured catalogue cache binding. Controls are not rendered as active actions for the local file backend, missing or invalid cache binding, invalid repository configuration, definitive authorisation denial, denied Contents read permission, or known unsupported refresh routes; Diagnostics shows concise recovery guidance instead.

Refresh failure leaves the current catalogue in place. The artifact workspace links to Diagnostics only for exceptional stale or degraded catalogue states and does not duplicate the refresh controls.

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
* last successful catalogue refresh time, or `unknown` when no successful refresh timestamp is available;
* manual catalogue Refresh and Full rebuild controls;
* stale and degraded catalogue explanations;
* repository artifact validation results;
* overall operational state.

Diagnostics presents every typed status with a shared accessible badge: green denotes successful checks, amber denotes impaired or unverified checks, red denotes failures that prevent a required capability, and grey is reserved for informational or unsupported states. Text labels and a status marker accompany colour. The overall state includes a stable explanation: `healthy` means all required checks succeeded; `degraded` means the application remains usable but functionality is partial, impaired, or uncertain; the misconfigured, unauthorized, invalid-content, and unavailable states explain the corresponding blocking failure.

When the overall state is not healthy, Diagnostics shows up to five ordered, deduplicated, safe contributing reasons and reports the number omitted. Contributors point to the relevant card and never contain credentials, raw GitHub responses, artifact bodies, or exception text.

Installation credential failures use safe typed categories. Network failures and server errors are temporarily unavailable; 401 is authentication failure; 403/404 means the installation is unavailable; 422 is a rejected capability request; 429 is rate limited; other unsuccessful statuses are request failures. `malformed_response` is reserved for a successful response with invalid JSON or without a valid token. Missing requested permissions in an otherwise valid credential are reported as denied rather than malformed. The proposal capability continues to request and verify both Contents write and Pull requests write without broadening permission levels.

All user-facing Diagnostics event times and the deployment time reuse one client locale formatter with day, short month, year, hour, minute, and short local timezone. Semantic `<time>` markup retains the canonical ISO value in both `dateTime` and `title`, while server rendering supplies a stable canonical fallback; missing event times remain `unknown`.

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

Operational states provide an explanation, recovery guidance, retry behavior where appropriate, and access to diagnostics. Expected artifact detail and edit operational states retain the shared protected application header and constrained content shell so Artifacts remains active and Diagnostics remains reachable; unauthenticated redirects and not-found responses remain outside this shell.

### 8.5 Safe diagnostics behavior

* Diagnostics performs read-only capability and repository checks.
* Configuration secrets are represented as configured, missing, or invalid states.
* Responses and logs use stable categories, counts, identifiers, and timings.
* Artifact bodies, complete frontmatter, access tokens, encrypted token fields, session identifiers, cache keys, and cached contents are excluded.

## 9. Presentation and deployment identity

### 9.1 Responsive interface

* Protected application pages use a shared compact application header with the product identity `Artifact Toolkit`, the purpose line `Manage reusable work assets` on sufficiently wide screens, primary navigation, one visible signed-in user identity, theme control, and a clearly labelled sign-out control.
* Primary navigation is declared through a reusable navigation model and initially links to `Artifacts` and `Diagnostics`. Active links use a visible active treatment and `aria-current="page"`.
* The header uses semantic `<header>` and `<nav aria-label="Primary">` landmarks. Navigation links route between pages and are not implemented as ARIA tabs.
* On mobile, account controls remain in the first row while the primary navigation is keyboard-reachable in a horizontally scrollable, non-wrapping second row that avoids whole-page overflow.
* Application content uses constrained, responsive layouts.
* The artifact workspace avoids a promotional hero. Its compact feature header keeps the `Create artifact` link inside the artifact feature area rather than in global navigation.
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

## 9. Durable sequential agent workflows (WF-001)

* **Framing:** the framework deterministically owns invocation order, persistence, retry, cancellation, timestamps and visibility; configured agents own reasoning and text formatting. WF-001 is not an autonomous multi-agent framework.
* **Sources of truth:** draft Agent and Workflow definitions are canonical JSON in Git. D1 is the operational source of truth for immutable run snapshots, attempts and raw text. Cloudflare Workflows coordinates execution from a run ID only. The artifact catalogue KV cache is not run storage.
* **Concepts:** a Connection is a safe browser-visible reference to server-only adapter configuration; an Agent selects a connection and master prompt; a Workflow is an ordered, acyclic sequence; a Run freezes those definitions and records its history.
* **Handoff:** step one receives the initial input. Every later step receives the exact previous output after its UTF-8 D1 storage round trip, without trimming, parsing, summarising or transforming it.
* **Adapter boundary:** adapters receive prompt and input separately and may complete synchronously or expose a safely persisted task ID for polling. Credentials are resolved server-side and excluded from snapshots, responses, logs and errors.
* **Recovery:** stable per-attempt idempotency keys and compare-and-set transitions prevent duplicate work; deterministic generation launch IDs allow ordinary run-detail observation, including the normal run-status page, to reclaim stale `launching` claims after two minutes without the original client idempotency key, and a step claim racing cancellation converges to cancellation before provider work begins. Only transient failures retry automatically, attempts are retained, and cancellation stops local progression even when provider cancellation is unsupported.
* **Launch durability:** a generation-specific launch reservation ensures concurrent browser requests create at most one Cloudflare Workflow instance. A start reports a live launch reservation as in progress rather than attached; run-detail observation performs bounded reconciliation only for nonterminal persisted `launching` state. Failed launches are explicit and recoverable, while terminal idempotency replays return the original run without relaunching it.
* **Retry separation:** automatic retries stay in the current Workflow instance after durable exponential backoff; eligible manual retries retain history and reserve a new Workflow generation.
* **Limitations:** workflows are draft, sequential and acyclic, with bounded steps, transitions, attempts, duration and text sizes. There is no branching, mapping, scripting, streaming, scheduling or production promotion.
* **Deterministic adapter:** the deterministic test connection makes handoffs, pending work, failures and cancellation testable. It does not perform AI reasoning and is not an AI provider; production enablement requires an explicit safe flag.
* **OpenAI Responses provider (WF-002):** the fixed OpenAI endpoint uses a server-only `encrypted D1 provider connection` and safe deployment-configured `D1 provider model configuration`. Background create, retrieve and cancel map directly to the generic adapter's start, check and cancel operations; Response IDs are persisted as provider task IDs. Creates use `store=false`, `masterPrompt` becomes `instructions`, and persisted raw input becomes `input` unchanged. No tools or provider conversation are enabled. Ordered textual message output (including documented textual refusals) is persisted without reasoning or raw response data. Ambiguous creates fail as non-automatic `provider_start_ambiguous`; the deterministic adapter remains the local test facility.


### Provider credential storage

Provider credentials are never stored in Git. Configured provider credentials are encrypted with AES-256-GCM before persistence in D1. The provider-secret encryption root remains a Cloudflare Worker secret and is never stored in D1. Models are safe D1 connection configuration; provider endpoints remain fixed in application code.

## Codex Cloud workflow entry point (WF-003)

* Codex Cloud owns repository execution and GitHub integration. ADT supplies the exact deterministically framed prompt and a safe reference to a preconfigured environment, persists the provider task before polling, and succeeds only when the resulting pull request is available.
* Safe D1 environment records contain only an environment key, display name, external environment ID, and enabled state. They never contain GitHub credentials, repository configuration, environment variables, setup scripts, commands, headers, endpoints, or secrets.
* Coding completion, user-visible summary, and safe task URL are persisted before PR publication. Publication retry reuses completed coding work; ambiguous creation and ambiguous publication never blindly duplicate repository-writing work. The final external URL is the PR URL.
* A Codex-backed agent may appear only as the final step in WF-003. Codex task URLs are auxiliary; no post-PR workflow step or automatic merge is implemented.
* Official OpenAI Codex documentation was reviewed on 2026-08-08 and did not document a supported server-to-server Cloud task lifecycle satisfying creation, stable identity, polling, textual result, structured PR publication/result, reconciliation, and cancellation needs. Production `codex-cloud-primary` is therefore intentionally shown as `Transport unavailable`. Real Codex Cloud execution is unavailable until OpenAI exposes a supported server-to-server Codex Cloud transport that satisfies the gateway contract.
# Self-hosted Codex Runner

The Codex connection is `codex-primary` with adapter `codex-runner`. It authenticates a ChatGPT account on the independently deployed home Runner; ADT persists no ChatGPT credential. Safe connection states are configuration missing, unavailable, disconnected, waiting for device authorization, connected, and update required. Existing `codex-cloud` definitions remain readable in a deprecated/unavailable state.

The Runner pins OpenAI Codex release 0.147.0 at exact official source commit `be6e8eac029b183056b7e4402879f15d2c85f61b`; `0.118.0` was the previous validated pin, and this controlled upgrade tests the newer shared auth-route HTTP client without claiming it fixes the observed production failure. Before an image can advertise device authentication, its installed generated App Server schema is deterministically checked for the `chatgptDeviceCode` request and the `loginId`, `verificationUrl`, and `userCode` response contract. Connect, refresh, and logout failures produce concise safe card feedback; an expired ADT session may expose only the application's validated same-origin sign-in URL. ADT and Runner observability contains bounded transport/category and allowlisted operation codes, never raw App Server errors, response bodies, credentials, tokens, stderr, or redirects.

Device authentication traverses Browser -> ADT -> Cloudflare Worker -> Cloudflare Access -> Cloudflare Tunnel -> Node Runner -> `codex app-server` -> Codex Rust/reqwest -> DNS/address selection -> TCP -> TLS -> Cloudflare's `auth.openai.com` edge -> device-auth API. Inbound tunnel success does not prove outbound Codex connectivity, and Node connectivity does not guarantee Rust/reqwest behavior. `ipv6Available=true` records an advertised AAAA address, not usable IPv6. The inspected 0.147 feature graph continues to omit reqwest's optional Hickory DNS resolver. For the first controlled comparison, the Runner image installs a validated, complete glibc precedence table that prefers IPv4-mapped destinations without disabling IPv6; the setting is image-local, marked by `CODEX_RUNNER_ADDRESS_POLICY=ipv4_preferred`, and reversible with the image. OpenAI's 0.147 Linux npm/release packaging selects `x86_64-unknown-linux-musl`, so Node/glibc ordering previously could not prove that policy applied to Codex. ADT now builds unchanged official source with the upstream package builder for `x86_64-unknown-linux-gnu` (not an OpenAI-published GNU prebuilt artifact), writes deterministic package output, validates canonical target metadata, the GNU ELF relationship, exact version, and App Server schema, and installs it as the sole Codex executable. A root-owned read-only image marker supplies the bounded libc classification; the ADT client remains compatible with #177 protocol-v1 diagnostics where the additive fields are absent. The bounded native-libc and Codex-policy fields distinguish applicability from Node's observed ordering; neither is proof of the address selected by a request. The operator `disable_ipv6` sysctl is not required and did not fix the production incident.

The shared-secret-protected diagnostic reports bounded Codex-version consistency, resolver order, policy effectiveness, namespace IPv6 state, allowlisted TCP/TLS failure reasons, and fixed-path `HEAD` probes for the origin and actual device-auth route over HTTP/1.1 and HTTP/2. A no-User-Agent probe preserves the pre-upgrade comparison and a truthful named non-browser probe detects client-identification sensitivity without browser spoofing. Only status, challenge, redirect presence, parsed content kind, exact Cloudflare-edge presence, and an optional validated three-letter Cloudflare colo are returned. A `cf-mitigated: challenge` response is upstream mitigation rather than ADT authorization failure; diagnostics neither solve nor bypass it. No address, body, Location, arbitrary header, raw socket/TLS error, certificate, cipher, path, secret, raw App Server error, or Codex stderr crosses the boundary.

The installed 0.147 binary's schema is build-validated for related initialize, account/read, device-login, and logout contracts. File credential storage remains compatible with persistent `CODEX_HOME`; no new proxy, CA, secret, or production environment setting is required. Operators run diagnostics before the first manual Connect test.

The repository builds `codex-runner/Dockerfile` and trusted `main` publishes `poulti/adt-codex-runner:<full-git-sha>` plus `latest`. Publication never deploys, calls Portainer, changes Shepherd, connects to the home cluster, or restarts a home service. Manual refresh or Shepherd adopts `latest` later while the persistent `CODEX_HOME` volume retains authentication. See `codex-runner/README.md` for Tunnel, Access, Docker secret, and deployment details.


Device-start failures remain bounded by `device_auth_start_failed` while an allowlisted reason distinguishes disabled or unavailable device login, upstream rejection, forbidden, rate limiting, upstream unavailability, pre-response transport failure, CA configuration, HTTP-client configuration, internal failure, and unknown failure. Only strictly derived numeric status/code metadata may be logged; raw App Server messages and data never cross the Runner boundary.
