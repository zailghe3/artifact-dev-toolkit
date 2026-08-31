# Feature request shaping

Load this reference when a feature request needs substantial shaping, when several related features are being created together, or when an existing request is being promoted or re-baselined.

The goal is to preserve durable product intent without encoding a speculative implementation plan.

## Durability tests

Apply these tests before keeping a requirement:

1. **Predecessor-independence test** — would this still need to be true if earlier planned features were implemented differently but correctly?
2. **Replacement test** — would this still need to be true if this feature's internal implementation were replaced while preserving the intended behaviour?

Keep requirements that survive those tests, especially:

- user-visible behaviour;
- stable domain rules and external contracts;
- security and trust boundaries;
- failure and recovery semantics;
- data-integrity and compatibility constraints;
- other durable invariants.

Demote or remove implementation predictions such as file names, function/helper names, component structure, internal routes, algorithms, storage choices, branch naming, internal error codes, or exact API sequences unless the mechanism itself is part of the required contract.

Prefer black-box acceptance criteria that can be verified from observable behaviour or stable contracts.

## Canonical field guidance

Use the canonical fields with these meanings:

- `objective`: the durable product or engineering outcome, not the implementation approach. It should normally remain valid if predecessor features are implemented differently.
- `currentBehaviour`: the capability gap observed at planning time. Keep it concise; implementation must re-establish current state from `main`.
- `requiredBehaviour`: the stable end-state behaviour.
- `functionalRequirements`: behavioural requirements and stable invariants, not an implementation task list.
- `technicalConsiderations`: architecture, security, compatibility, or operational constraints that must be respected; not an implementation plan.
- `acceptanceCriteria`: observable or contract-level evidence that the outcome is satisfied.
- `codexGuidance`: optional, non-binding context worth revalidating against current `main`, such as areas to inspect or known traps. Do not prescribe an internal solution unless that mechanism is itself required.

Express dependencies as required capabilities or invariants rather than predicted outputs from earlier Feature IDs.

## Multi-feature shaping

When several features are designed together:

1. Compare every later feature with the durable outcomes of earlier features.
2. Do not create a later feature whose main purpose is to repair a predicted implementation choice of an earlier one.
3. Merge overlapping outcomes when they form one coherent independently useful capability.
4. Keep separate features independently useful and independently testable.
5. If an earlier feature could legitimately satisfy part of a later feature, describe only the residual durable outcome.
6. If a later feature cannot be made implementation-ready until predecessor results are known, keep it `planned` instead of manufacturing detailed assumptions.

## Planned versus ready

Use `ready` only when the objective, behavioural requirements, constraints, scope, and acceptance criteria are stable enough to implement from the current repository state without unresolved predecessor outcomes.

Use `planned` when the outcome is worth preserving but implementation context is still likely to depend materially on earlier work.

Historical request records without `requestStatus` are treated as `ready` for backward compatibility, but new records must set the field explicitly.

Changing a request back to `planned` does not close or undo an implementation issue that has already been created.

## Promotion and re-baselining

When promoting or re-baselining an existing planned request:

1. Preserve its `requestId` and Feature ID.
2. Inspect current `main`, current specifications, relevant issues and pull requests, and current architecture.
3. Remove requirements already satisfied by intervening work.
4. Remove or rewrite stale implementation assumptions.
5. Reapply the durability tests and multi-feature analysis above.
6. Confirm the remaining feature is still independently useful and testable.
7. Set `requestStatus` to `ready` only after that re-baseline.

## Conflict and incompleteness handling

Do not invent unresolved product decisions.

Stop and report rather than guessing when:

- supplied requirements materially conflict;
- the outcome is too incomplete to preserve a clear durable contract;
- an equivalent canonical request already exists;
- a later feature's useful scope cannot yet be separated from unknown predecessor results.

The request record should preserve the agreed product outcome, not create certainty where the product decision is still unresolved.
