# Codex feature-request creation

This document explains the stable feature-request hand-off for maintainers. The authoritative Codex procedure is the repo-local [`$feature-request-creation`](../.agents/skills/feature-request-creation/SKILL.md) Skill. Repository-wide conventions in [`AGENTS.md`](../AGENTS.md) also apply.

Use this flow when agreed product requirements need to become canonical request data before implementation.

## Stable workflow

```text
Agreed durable product outcome(s)
-> $feature-request-creation shapes outcome-stable requests
-> feature-request/<request-id>
-> requests/features/<request-id>.json
-> requestStatus: planned or ready
-> validation and dry-run rendering
-> one request-only pull request
-> merge stores all requests permanently
-> ready requests create implementation issues
-> planned requests wait for re-baselining and promotion
```

- The supplied `requestId` is the stable orchestration identity and must remain lowercase and URL-safe.
- The current `.github/ISSUE_TEMPLATE/feature-schema.json` is authoritative for request fields, lifecycle values, and validation.
- New request records set `requestStatus` explicitly to `planned` or `ready`.
- Existing historical request records without `requestStatus` are treated as `ready` for backward compatibility.
- Request records remain permanent under `requests/features/`; lifecycle is metadata on the same canonical record rather than a separate folder.
- When several requests are agreed together, put them in one pull request unless the user explicitly asks for separate PRs.

## Outcome-stable request design

A feature request is a contract for the desired end state, not a forecast of the implementation path.

- Objectives describe durable outcomes that should remain valid if predecessor features are implemented differently but correctly.
- `currentBehaviour` records the product or capability gap observed at planning time rather than a detailed inventory of current files and helpers.
- `functionalRequirements` contains behavioural requirements and stable invariants, not an implementation task list.
- `technicalConsiderations` contains architecture, security, compatibility, deployment, migration, or operational constraints that must be respected, not a solution design.
- `acceptanceCriteria` should be observable or contract-level where practical and should not require a particular internal implementation to pass.
- `codexGuidance` is non-binding implementation context that must be revalidated against current `main`.
- File names, function names, internal routes, helper names, algorithms, storage mechanisms, branch naming, internal error codes, and exact API sequences normally belong to implementation-time analysis unless they are themselves part of an external contract.
- Dependencies between features should be expressed as capabilities or invariants that must exist, not as assumptions about how earlier Feature IDs will implement them.

## Planned and ready

Use `requestStatus: "ready"` only when the feature has been revalidated against current `main` and its objective, behavioural requirements, constraints, scope, and acceptance criteria can be implemented without relying on unresolved predecessor outcomes.

Use `requestStatus: "planned"` when the durable outcome is worth preserving but later implementation detail or exact residual scope is likely to depend on earlier work.

A planned request:

- validates and dry-run renders like a ready request;
- is stored permanently when its request PR merges;
- does not create a GitHub implementation issue;
- can be revised later without changing its stable `requestId` or Feature ID.

To promote a planned request:

1. inspect current `main`, current specifications, architecture, and relevant completed/open work;
2. remove requirements already satisfied by intervening changes;
3. remove or rewrite stale implementation assumptions;
4. confirm the remaining capability is still independently useful and testable;
5. update the canonical request to `requestStatus: "ready"` in a request-only PR;
6. after merge, the trusted workflow creates the implementation issue.

For a ready request, merge creates the corresponding GitHub issue. Changing a record back to planned does not close or undo an issue that already exists.

## Multi-feature batches

When several features are designed together:

- compare each later feature against all earlier proposed outcomes;
- do not create a later feature whose main purpose is to repair a predicted implementation choice of an earlier feature;
- combine overlapping outcomes when they are one coherent capability;
- keep separate features independently useful and independently testable;
- keep later uncertain features planned rather than adding speculative detail just to make them implementation-ready.

## Boundaries

- Do not implement the feature.
- Do not modify application runtime code merely to submit a request.
- Do not create the GitHub issue directly.
- Do not move canonical request files into lifecycle folders.
- Do not turn planning-time implementation observations into binding requirements unless the mechanism is genuinely part of the product or external contract.
- Do not weaken validation, CI, branch protection, auto-merge, idempotency, or post-merge issue creation.
- Let the post-merge workflow create the issue from the permanent request record.

## Validation

The Skill must inspect the current repository-declared toolchain and commands rather than relying on remembered versions. The canonical request flow includes:

```bash
npm run toolchain:validate
npm run issue:validate
npm run issue:validate-request -- requests/features/<request-id>.json
npm run issue:render -- requests/features/<request-id>.json > /tmp/<request-id>-feature-issue.md
npm test
```

The renderer invocation is a dry run and must not create a GitHub issue. Planned requests render the issue they could produce after later re-baselining, but lifecycle metadata itself is not copied into the implementation issue body.
