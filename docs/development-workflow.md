# Development workflow

This repository uses a lightweight product-development workflow designed for a single maintainer working with ChatGPT for product design and Codex for implementation.

## 1. Workflow overview

```text
Idea or problem
  → discuss and refine the objective
  → define scope, UX, and acceptance criteria
  → create a GitHub issue
  → mark the issue ready for Codex
  → Codex implements the issue and opens a pull request
  → CI validates the change
  → review and merge
  → specification reflects the implemented application
```

The repository separates three concerns:

- **Product discussion:** clarify what should be built and why.
- **Feature ID:** identify a product capability independently from GitHub issue numbers.
- **GitHub issue:** provide the implementation contract for Codex and remain the canonical work-item tracker.
- **Current application specification:** describe what is actually implemented after the change is merged.

## 2. Discuss before implementation

Use product discussion to clarify:

- the user problem and intended outcome;
- the current behaviour;
- the desired user experience;
- functional requirements;
- architectural, security, and deployment constraints;
- edge cases;
- what is explicitly out of scope;
- observable acceptance criteria.

An idea should not be handed to Codex while material product decisions are still unresolved.

## 3. Feature IDs

Every feature issue must include a stable **Feature ID** before implementation starts. A Feature ID identifies the product capability being introduced or changed. It is separate from the GitHub issue number:

- the Feature ID identifies the capability across issues, pull requests, documentation, and follow-up discussion;
- the GitHub issue number remains the canonical work-item tracker and merge target;
- pull requests should include the Feature ID in their title or summary and still use `Closes #<number>` to close the GitHub issue.

Use the following convention unless a future repository decision changes it:

```text
<AREA>-<THREE_DIGIT_SEQUENCE>
```

Examples:

```text
DEV-001
ART-002
DOC-003
```

Choose a short uppercase area prefix that describes the capability area, followed by a three-digit sequence. Do not reuse a Feature ID for a different capability.

## 4. Create an issue

Use the appropriate issue form:

- **Feature request** for a new capability or improvement;
- **Bug report** for incorrect or unexpected behaviour.

An implementation-ready issue should be understandable without relying on a separate chat history. It should contain enough context for Codex to identify the intended outcome and verify completion. Each feature issue must be a self-sufficient implementation contract: Codex should not need product chat transcripts, external notes, or undocumented assumptions to complete the work.

### Suggested labels

Use a small, consistent label set:

```text
type:feature
type:bug
type:documentation
type:technical-debt

status:needs-design
status:ready-for-codex
status:blocked

priority:high
priority:medium
priority:low
```

`status:ready-for-codex` means:

- the objective is clear;
- the scope has been agreed;
- required behaviour and acceptance criteria are documented;
- known technical constraints are recorded;
- Codex can begin without further product clarification.

Do not use the `auto-merge` label on issues. It applies to pull requests only.


### Automated feature issue requests

The supported programmatic feature-request workflow is ChatGPT-to-Codex hand-off. ChatGPT is responsible for product definition and the complete structured feature content. Codex is responsible for repository changes, validation, commits, and pull requests.

Feature planning flow:

```text
Discuss and agree one or more features
→ ChatGPT generates one Codex prompt
→ Codex creates all feature JSONs in one PR
→ CI validates
→ auto-merge
→ one issue per JSON is created automatically
```

Codex should follow `docs/codex-create-feature-request.md`, create `feature-request/<request-id>`, write canonical design records under `requests/features/<request-id>.json`, run repository validation, open a non-draft pull request, and stop. When several feature requests are agreed together, put all of the corresponding JSON files in one pull request unless the user explicitly asks for separate PRs. Codex must not implement the feature and must not create the GitHub issue directly.

Feature JSON files remain permanently in `requests/features/` as design records. They are not moved to processed or failed folders as workflow state, and there is no pending-to-processed branch or pull-request lifecycle. Legacy files from the previous `pending`, `processed`, and `failed` layout were migrated into the canonical directory without losing request content.

Each request JSON must include an immutable `requestId` matching its file name. The issue renderer prepends a hidden marker such as:

```html
<!-- feature-request-id: ui-001-theme-support -->
```

Before creating an issue, automation searches open and closed issues for that exact marker. If the marker exists, issue creation is skipped; if it is absent, one new issue is created. Folder state and issue titles are not the source of truth for idempotency.

Normal post-merge automation processes only canonical feature JSON files added or modified by the merged pull request. Manual recovery is available through the `Create feature issues from requests` workflow with `mode: all`, which scans every canonical request file and relies on immutable markers to avoid duplicates. If issue creation partially fails, successfully created issues remain valid; rerunning skips those markers and retries only missing issues.

Run local validation for one or more files with:

```bash
npm run issue:validate-request -- requests/features/ui-001-theme-support.json
```

The post-merge orchestration workflow is explicit because merges performed with the repository `GITHUB_TOKEN` must not rely on suppressed push-event chaining:

```text
Feature-definition PR merged
→ post-merge orchestration inspects changed files
→ changed feature JSON files are validated and create issues
```

No personal access token, GitHub App token, direct push to `main`, processing branch, or lifecycle pull request is required.

## 5. Codex implementation launch

Feature implementation flow:

```text
Give Codex the full issue URL
→ Codex implements and opens PR
→ CI validates
→ auto-merge
→ issue closes
→ Cloudflare deployment runs automatically
```

Launching Codex for a feature issue should require only three steps:

1. Complete and review the issue.
2. Mark it ready for Codex.
3. Give Codex only the full GitHub issue URL.

A typical Codex instruction is now minimal:

```text
Implement this issue: https://github.com/zailghe3/artifact-dev-toolkit/issues/<number>
```

The feature issue template contains the complete Codex execution contract, including repository verification, issue-as-source-of-truth requirements, scope boundaries, specification maintenance, validation, and pull request closing expectations. No additional implementation prompt should normally be required.

Use the full GitHub issue URL rather than only an issue number. Issue numbers alone are discouraged because they are ambiguous outside a confirmed repository context and make it easier to launch Codex against the wrong repository or work item.

Codex should use the issue as the complete source of truth for scope. Material deviations should be discussed and reflected in the issue before implementation continues.

## 6. Pull request expectations

Each implementation pull request should:

1. include the Feature ID in the title or summary;
2. link to the issue using `Closes #<number>` or an equivalent closing keyword;
3. explain the user-visible and technical changes;
4. remain within the issue scope;
5. include relevant tests or validation;
6. pass CI, typechecking, and production build checks;
7. review the current application specification;
8. update `specs/000-current-application-spec.md` in the same pull request whenever implemented or expected behaviour changes;
9. identify any intentional follow-up work rather than silently expanding scope.

The specification update is part of development, not a later documentation task.

For a behaviour-changing feature, a pull request is incomplete until the specification describes the new implemented state.

For a bug fix, the specification must be reviewed. Update it when the fix changes documented behaviour or exposes that the previous specification was inaccurate. A purely internal fix may require no text change, but the PR should state that the specification was reviewed.

## CI/CD lifecycle automation

The repository uses a deterministic GitHub Actions lifecycle with one entry workflow for pull requests, one entry workflow for pushes to `main`, and a separate privileged workflow that only enables trusted auto-merge. Reusable atomic workflows are called directly with `workflow_call`; workflows do not continue the pipeline by applying labels, dispatching other workflows with `gh workflow run`, or relying on events emitted by actions taken with `GITHUB_TOKEN`.

```text
Pull request
  → PR lifecycle / classify-pr
  → PR lifecycle / verify-pr
  → PR lifecycle / validate-feature-requests when requests/features/*.json changed
  → Trusted auto-merge may enable squash auto-merge for owner-authored, same-repo, non-sensitive PRs
  → GitHub waits for required checks
  → squash merge creates a native push to main
  → Main lifecycle / classify-main
  → Main lifecycle / verify-main
     ├─ create-feature-issues for changed feature JSON files
     └─ deploy-cloudflare for deployable changes
```

Entry workflows and triggers:

- `PR lifecycle` (`.github/workflows/pr-orchestrator.yml`): `pull_request` on `opened`, `synchronize`, `reopened`, and `ready_for_review`. It has read-only permissions, validates all PRs, never accesses production secrets, never creates issues, never deploys, and never enables a merge.
- `Trusted auto-merge` (`.github/workflows/auto-merge.yml`): `pull_request_target` on the same PR activity types. It never checks out or executes PR code. It only uses metadata and the complete paginated PR file list to decide whether to label and enable squash auto-merge.
- `Main lifecycle` (`.github/workflows/main-orchestrator.yml`): `push` to `main`. It operates on the exact pushed commit, verifies it, then runs feature issue creation and Cloudflare deployment as independent sibling jobs. Failure in one side-effecting job does not block the other.
- `Manual feature issue recovery` and `Manual Cloudflare deployment` are thin `workflow_dispatch` wrappers around the same reusable workflows. Operators must provide an explicit target ref or SHA; the safe default is `main`.

Reusable workflows:

- `Reusable / classify changes` gathers changed files with explicit repository context, handles PR API pagination, detects canonical request files under `requests/features/*.json`, sensitive CI/CD files, documentation/request-only changes, and deployable changes.
- `Reusable / verify` runs `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` with Node.js 22 and read-only permissions. `npm ci` intentionally fails if `package.json` and `package-lock.json` drift.
- `Reusable / validate feature requests` validates changed canonical feature JSON files, validates the issue template contract, and dry-run renders issues without writes.
- `Reusable / create feature issues` checks out the exact verified main commit, runs `npm ci`, and uses the immutable `<!-- feature-request-id: ... -->` marker to create only missing issues. It is safe to rerun after partial failure.
- `Reusable / deploy Cloudflare` checks out the exact verified commit, runs `npm ci`, builds the production worker with `npm run build:worker`, validates Cloudflare secrets inside the deployment job, deploys with Wrangler in the `production` environment, and records the deployed commit in the job summary. Production deployments use a non-cancelling concurrency group.

Required status checks should be migrated to the stable PR check names `classify-pr`, `verify-pr / verify`, and, if branch protection supports conditionally required checks without deadlock, `validate-feature-requests / validate-feature-requests`. Because feature validation is skipped for non-feature PRs, the safest always-required checks are classification and verification. Update branch protection only after this CI/CD PR is manually merged and the new workflow names have appeared at least once.

Feature request PR timeline:

```text
ChatGPT prompt
→ Codex creates one or more requests/features/*.json files
→ Codex opens a non-draft PR
→ PR lifecycle classifies changes
→ general verification runs
→ feature-request validation runs
→ trusted auto-merge enables auto-merge if eligible
→ GitHub waits for required checks
→ GitHub auto-merges
→ push to main triggers Main lifecycle
→ exact main commit is verified
→ feature issues are created idempotently
→ deployment is skipped because canonical feature-request-only changes are conclusively non-runtime changes
```

Implementation PR timeline:

```text
Issue
→ Codex implements code, tests, and specifications
→ Codex opens a non-draft PR with an exact closing reference
→ PR lifecycle runs tests, typecheck, and build
→ trusted auto-merge enables auto-merge if eligible
→ GitHub waits for required checks
→ GitHub auto-merges and closes the issue
→ push to main triggers Main lifecycle
→ exact main commit is verified
→ Cloudflare deployment runs
```

Sensitive CI/CD PR timeline:

```text
Codex opens a PR touching sensitive paths
→ PR validation still runs
→ Trusted auto-merge skips successfully
→ human reviews and manually merges
→ push to main triggers the same verified post-merge path
```

Sensitive paths are `.github/workflows/**`, `.github/actions/**`, `scripts/**`, `package.json`, `package-lock.json`, `wrangler.jsonc`, and `open-next.config.*`. The trusted auto-merge workflow checks both `filename` and `previous_filename` for added, modified, renamed, and deleted files, including files on later API pages. User-controlled labels are never authorization. This CI/CD stabilisation PR touches sensitive workflow and script files, so it must remain available for manual review and manual merge.

Deployment policy is conservative: after every verified merge to `main`, deploy unless the change is conclusively documentation-only or feature-request-only. The skip set is intentionally narrow (`docs/**`, `specs/**`, `requests/features/**`, root `*.md`, and `README.md`) so runtime-relevant root configuration changes are not silently skipped.

Production secret boundary: PR workflows have read-only permissions and receive no Cloudflare secrets. Cloudflare credentials are passed only from the main/manual deployment caller to `Reusable / deploy Cloudflare`, and only the deployment job runs in the `production` environment. Privileged `pull_request_target` auto-merge never checks out PR code.

Recovery procedures:

- Failed PR validation: fix the branch and push again; `synchronize` reruns classification, verification, feature validation, and auto-merge eligibility.
- Failed feature issue creation: rerun `Manual feature issue recovery` with `mode: changed` and explicit newline-separated files, or `mode: all` to reprocess every canonical request. Existing marker-bearing issues are skipped.
- Failed deployment: rerun `Manual Cloudflare deployment` with the exact main SHA that already passed verification, or `main` to deploy the current branch tip.
- Manual deployment of a specific commit: run `Manual Cloudflare deployment`, set `ref` to the desired main commit SHA, and confirm the job summary records that SHA.
- Reprocessing feature requests: run `Manual feature issue recovery`; immutable request markers make all recovery modes idempotent.

Migration sequence:

1. Manually review and merge this sensitive CI/CD PR; do not rely on auto-merge for it.
2. Let the native push to `main` run `Main lifecycle`; enabling GitHub auto-merge for future PRs does not suppress this native push-to-main workflow because the post-merge continuation is the `push` event itself, not a token-generated dispatch chain.
3. Update branch protection from legacy `CI` checks to `classify-pr` and `verify-pr / verify` after the new checks appear.
4. Keep manual merge required for future sensitive CI/CD changes.
5. If DATA-001 or any earlier runtime-relevant commit was not deployed during the old workflow transition, run `Manual Cloudflare deployment` against the current `main` SHA. If feature issues from DATA-001 are missing, run `Manual feature issue recovery` with `mode: all`.
