# Codex feature-request creation instructions

Use this procedure only when Codex is asked to submit structured feature-request data to this repository. This creates a request for later issue creation; it does **not** implement the feature.

Repository-wide conventions in [`AGENTS.md`](../AGENTS.md) also apply.

## Required workflow

1. Verify that the working repository is `zailghe3/artifact-dev-toolkit`.
2. Read `.github/ISSUE_TEMPLATE/feature-schema.json` and the supplied structured request data.
3. Create `feature-request/<request-id>` using the exact supplied `requestId`.
4. Create `requests/features/<request-id>.json`.
5. When several requests are agreed together, put them in one pull request unless the user explicitly asks for separate PRs.
6. Preserve supplied requirements without shortening, replacing, or inventing product decisions.
7. Keep the JSON compatible with the current feature schema.
8. Validate the request and dry-run the canonical renderer.
9. Run the repository checks relevant to a request-only change.
10. Open a non-draft pull request summarising the request and validation results.
11. Stop after opening the pull request.

## Boundaries

- Do not implement the feature.
- Do not modify application code to satisfy the request.
- Do not create the GitHub issue directly.
- Do not move canonical request files into lifecycle folders.
- Do not weaken validation, CI, branch protection, auto-merge, idempotency, or post-merge issue creation.
- Let the post-merge workflow create the issue from the permanent request record.

## Input contract

`requestId` is required for orchestration and must be a lowercase URL-safe identifier, for example `ui-001-theme-support`.

The request file uses fields defined by `.github/ISSUE_TEMPLATE/feature-schema.json`, including:

- `featureId` — stable capability ID;
- `title` — optional human-readable title;
- `priority` — optional maintainer metadata;
- `objective` — intended outcome;
- `userContext` — who needs the feature and why;
- `currentBehaviour` — current product state;
- `requiredBehaviour` — required state after implementation;
- `userExperience` — optional UX guidance;
- `functionalRequirements` — concrete requirements;
- `technicalConsiderations` — optional architecture, security, compatibility, or deployment constraints;
- `outOfScope` — explicit exclusions;
- `acceptanceCriteria` — observable completion criteria;
- `codexGuidance` — optional implementation guidance for the later issue-based task.

The schema is authoritative for required fields and rendering behaviour. Do not duplicate its full definition here.

## Validation

Use the repository-declared toolchain. For each request, run the relevant canonical commands, including:

```bash
npm run toolchain:validate
npm run issue:validate
npm run issue:validate-request -- requests/features/<request-id>.json
npm run issue:render -- requests/features/<request-id>.json > /tmp/<request-id>-feature-issue.md
npm test
```

The renderer invocation above is a dry run. It must not create a GitHub issue.
