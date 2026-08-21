---
name: feature-request-creation
description: Create one or more canonical ADT feature-request JSON records and a request-only pull request. Use when asked to create, submit, or formalise ADT features before implementation; do not use for feature implementation.
---

# Feature request creation

Use this Skill to turn already-agreed product requirements into the repository's canonical feature-request record.

## Inputs

- One or more agreed feature payloads.
- A stable `requestId` and Feature ID for each request.
- Any explicitly permitted base branch or grouping requirement.

Do not invent unresolved product decisions. If supplied requirements conflict materially, are incomplete enough to prevent a valid request, or describe an already-existing equivalent request, stop and report the conflict instead of guessing.

## Procedure

1. Confirm the repository is `zailghe3/artifact-dev-toolkit` and inspect the latest intended base branch.
2. Read the applicable `AGENTS.md` files, `.github/ISSUE_TEMPLATE/feature-schema.json`, `docs/development-workflow.md`, and nearby canonical request records when useful.
3. Search the current repository state for the same `requestId`, Feature ID, or an equivalent existing request, issue, pull request, or branch. Do not create a duplicate.
4. Create `feature-request/<request-id>` from the intended current base unless the task explicitly names another branch.
5. Write each request to `requests/features/<request-id>.json`.
6. Preserve the agreed product intent. Adapt only representation or schema details required by the current canonical schema.
7. When several requests are agreed together, put them in one pull request unless the user explicitly asks for separate PRs.
8. Validate each request and dry-run the canonical renderer.
9. Run the repository checks relevant to a request-only change.
10. Inspect the final diff and confirm it contains only the intended request records and any genuinely required request-workflow maintenance.
11. Open one focused non-draft pull request summarising the requests and validation results.
12. Stop after the pull request is open.

## Canonical validation

Use the repository-declared toolchain and inspect `package.json` for current commands. The normal request workflow includes the repository's toolchain validation, feature-issue/template validation, per-request validation, dry-run rendering, and relevant tests.

## Boundaries

- Do not implement the feature.
- Do not modify application runtime code merely to submit the request.
- Do not create the GitHub issue directly.
- Do not move request records into lifecycle folders.
- Do not weaken validation, CI, branch protection, idempotency, auto-merge, or post-merge issue creation.
- Let the post-merge workflow create the issue from the permanent request record.
- Do not access or modify `zailghe3/fpo-artifacts` unless the task explicitly permits it.