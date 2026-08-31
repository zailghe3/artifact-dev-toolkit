---
name: feature-request-creation
description: Shape one or more durable ADT feature outcomes into canonical planned or implementation-ready request records and a request-only pull request. Use when asked to create, submit, formalise, re-baseline, or promote ADT features before implementation; do not use for feature implementation.
---

# Feature request creation

Turn agreed product intent into durable canonical feature-request records without freezing a speculative implementation.

## Inputs

- One or more agreed feature outcomes or existing planned request records.
- A stable `requestId` and Feature ID for each request.
- Any explicitly permitted base branch or grouping requirement.

Do not invent unresolved product decisions. If requirements materially conflict, are too incomplete to preserve a clear outcome, or duplicate an existing equivalent request, stop and report that instead of guessing.

## Core contract

Every request must:

- describe durable product behaviour, stable contracts, trust/security boundaries, failure semantics, data-integrity rules, compatibility constraints, or other invariants;
- use observable or contract-level acceptance criteria;
- avoid predicted files, helpers, components, internal routes, algorithms, storage mechanisms, branch names, internal error codes, or API sequences unless that mechanism is itself required;
- express dependencies as required capabilities or invariants rather than predicted predecessor implementations;
- remain useful and testable independently of speculative implementation choices.

For deeper shaping rules, canonical-field guidance, multi-feature analysis, or re-baselining, read [`request-shaping.md`](request-shaping.md). Load it when requirements need substantial shaping, several related features are being created together, or an existing request is being promoted/re-baselined.

## Request lifecycle

Set `requestStatus` explicitly on new records:

- `planned` — preserve an agreed durable outcome when implementation readiness still depends materially on unresolved predecessor outcomes or future context.
- `ready` — the outcome, requirements, constraints, scope, and acceptance criteria are stable enough to implement from current `main`.

Do not add speculative detail merely to make a planned request appear ready.

When promoting or re-baselining a planned request, preserve its IDs, inspect current repository state, remove already-satisfied or stale requirements, and apply the detailed rules in `request-shaping.md` before setting it to `ready`.

## Procedure

1. Confirm the repository is `zailghe3/artifact-dev-toolkit` and inspect the latest intended base branch.
2. Read applicable `AGENTS.md` files, `.github/ISSUE_TEMPLATE/feature-schema.json`, `docs/development-workflow.md`, and nearby request records when useful.
3. Shape the request using the core contract above; load `request-shaping.md` when its trigger applies.
4. Search current repository state for the same `requestId`, Feature ID, or equivalent request, issue, pull request, or branch. Do not create duplicates.
5. Choose `planned` or `ready`.
6. Create `feature-request/<request-id>` from the intended current base unless the task names another branch. For a batch, use one representative request ID or another concise repository-consistent name.
7. Write each request to `requests/features/<request-id>.json`, or update the existing canonical record when explicitly re-baselining or promoting it.
8. Preserve agreed product intent while adapting representation or schema details required by the current canonical schema.
9. Put several requests agreed together in one pull request unless the user explicitly asks for separate PRs.
10. Validate every request, dry-run the canonical renderer, and run the repository checks relevant to a request-only change using the repository-declared toolchain and current `package.json` commands.
11. Inspect the final diff and confirm it contains only intended request records and genuinely required request-workflow maintenance.
12. Open one focused non-draft pull request summarising the requests, lifecycle statuses, and validation results.
13. Stop after the pull request is open.

## Validation expectations

Both `planned` and `ready` records must validate and render successfully. A planned request is not eligible for post-merge implementation-issue creation; a ready request is.

Use the current repository workflow and commands rather than copying stale validation details into this Skill.

## Boundaries

- Do not implement the feature.
- Do not modify application runtime code merely to submit a request.
- Do not create the GitHub issue directly.
- Do not move request records into lifecycle folders.
- Do not make a request implementation-specific merely to increase apparent completeness.
- Do not weaken validation, CI, branch protection, idempotency, auto-merge, or post-merge issue creation.
- Let the post-merge workflow create the implementation issue from the permanent request record when it is ready.
- Do not access or modify `zailghe3/fpo-artifacts` unless the task explicitly permits it.
