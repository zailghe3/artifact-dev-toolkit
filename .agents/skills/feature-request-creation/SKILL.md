---
name: feature-request-creation
description: Shape one or more durable ADT feature outcomes into canonical planned or implementation-ready request records and a request-only pull request. Use when asked to create, submit, formalise, re-baseline, or promote ADT features before implementation; do not use for feature implementation.
---

# Feature request creation

Use this Skill to turn agreed product intent into durable canonical feature-request records without freezing a speculative future implementation.

## Inputs

- One or more agreed feature outcomes or existing planned request records.
- A stable `requestId` and Feature ID for each request.
- Any explicitly permitted base branch or grouping requirement.

Do not invent unresolved product decisions. If supplied requirements conflict materially, are too incomplete to preserve a clear product outcome, or describe an already-existing equivalent request, stop and report the conflict instead of guessing.

## Requirement shaping

Before writing or promoting a request, separate the durable feature contract from planning-time implementation context.

For every proposed requirement:

1. Apply the **predecessor-independence test**: would this still need to be true if earlier planned features were implemented differently but correctly?
2. Apply the **replacement test**: would this still need to be true if this feature's internal implementation were replaced while preserving the intended behaviour?
3. Keep user-visible behaviour, stable domain rules, external contracts, security and trust boundaries, failure semantics, data-integrity rules, compatibility constraints, and other durable invariants.
4. Prefer black-box acceptance criteria that can be verified from observable behaviour or stable contracts.
5. Remove or demote predicted file names, function or helper names, internal routes, component structure, algorithms, storage mechanisms, branch naming, internal error codes, exact API sequences, and other implementation mechanics unless that mechanism is itself an externally required contract.
6. Express dependencies as required capabilities or invariants, not as predicted implementation results of earlier Feature IDs.
7. Keep the objective focused on the durable outcome. An objective should normally remain valid even if predecessor features are implemented differently.

Use the canonical fields with these meanings:

- `objective`: the durable product or engineering outcome, not the implementation approach.
- `currentBehaviour`: the product/capability gap observed at planning time. Avoid a detailed implementation inventory; implementation must re-establish current state from `main`.
- `requiredBehaviour`: the stable end-state behaviour.
- `functionalRequirements`: behavioural requirements and stable invariants, not an implementation task list.
- `technicalConsiderations`: architecture, security, compatibility, or operational constraints that must be respected; do not use this field as an implementation plan.
- `acceptanceCriteria`: observable or contract-level evidence that the outcome is satisfied.
- `codexGuidance`: optional non-binding implementation context worth revalidating against current `main`, such as existing areas to inspect or known traps. Do not prescribe an internal solution here unless that mechanism is itself required.

## Multi-feature review

When several features are designed together:

1. Compare every later feature with the outcomes of the earlier features.
2. Do not create a later feature whose main purpose is to repair a predicted implementation choice of an earlier feature.
3. Merge overlapping outcomes when they form one coherent independently useful capability.
4. Keep separate features independently useful and independently testable.
5. If an earlier feature could legitimately satisfy part of a later feature, describe only the residual durable outcome rather than assuming the earlier implementation will leave specific work behind.
6. If a later feature cannot be made implementation-ready until earlier implementation results are known, keep it `planned` rather than manufacturing detailed assumptions.

## Request lifecycle

Canonical request records may use:

- `requestStatus: "planned"` — preserves an agreed durable outcome but does not create a GitHub implementation issue after merge.
- `requestStatus: "ready"` — has been revalidated against current `main` and is ready for issue creation and Codex implementation.

New request records must set `requestStatus` explicitly. Historical request records without the field are treated as `ready` for backward compatibility.

Use `ready` only when the objective, behavioural requirements, constraints, scope, and acceptance criteria are stable enough to implement from the current repository state without relying on unresolved predecessor outcomes.

Use `planned` when the feature is worth preserving but later implementation context is likely to depend materially on earlier work. Do not add speculative detail merely to make a planned feature look ready.

When promoting an existing planned request to ready:

1. Preserve its `requestId` and Feature ID.
2. Inspect current `main`, current specifications, relevant issues and pull requests, and current architecture.
3. Remove requirements already satisfied by intervening work.
4. Remove or rewrite stale implementation assumptions.
5. Reapply the requirement-shaping and multi-feature tests.
6. Confirm the remaining feature is still independently useful and testable.
7. Set `requestStatus` to `ready` only after that re-baseline.

Changing a request back to planned does not close or undo an implementation issue that has already been created.

## Procedure

1. Confirm the repository is `zailghe3/artifact-dev-toolkit` and inspect the latest intended base branch.
2. Read the applicable `AGENTS.md` files, `.github/ISSUE_TEMPLATE/feature-schema.json`, `docs/development-workflow.md`, and nearby canonical request records when useful.
3. Shape the requirements and choose `planned` or `ready` using the rules above.
4. Search the current repository state for the same `requestId`, Feature ID, or an equivalent existing request, issue, pull request, or branch. Do not create a duplicate.
5. Create `feature-request/<request-id>` from the intended current base unless the task explicitly names another branch. For a batch, use one representative request ID or another concise branch name consistent with repository practice.
6. Write each request to `requests/features/<request-id>.json`, or update the existing canonical record when explicitly re-baselining or promoting it.
7. Preserve the agreed product intent while removing unnecessary implementation prescription. Adapt representation or schema details required by the current canonical schema.
8. When several requests are agreed together, put them in one pull request unless the user explicitly asks for separate PRs.
9. Validate each request and dry-run the canonical renderer.
10. Run the repository checks relevant to a request-only change.
11. Inspect the final diff and confirm it contains only the intended request records and any genuinely required request-workflow maintenance.
12. Open one focused non-draft pull request summarising the requests, their lifecycle status, and validation results.
13. Stop after the pull request is open.

## Canonical validation

Use the repository-declared toolchain and inspect `package.json` for current commands. The normal request workflow includes the repository's toolchain validation, feature-issue/template validation, per-request validation, dry-run rendering, and relevant tests.

A planned request must validate and render successfully even though post-merge automation will not create its implementation issue. A ready request follows the same validation and becomes eligible for issue creation after merge.

## Boundaries

- Do not implement the feature.
- Do not modify application runtime code merely to submit the request.
- Do not create the GitHub issue directly.
- Do not move request records into lifecycle folders.
- Do not make a request implementation-specific merely to increase apparent completeness.
- Do not weaken validation, CI, branch protection, idempotency, auto-merge, or post-merge issue creation.
- Let the post-merge workflow create the issue from the permanent request record when it is ready.
- Do not access or modify `zailghe3/fpo-artifacts` unless the task explicitly permits it.
