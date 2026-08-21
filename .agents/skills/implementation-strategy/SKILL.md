---
name: implementation-strategy
description: Plan an ADT implementation before editing when work crosses security, persistence, concurrency, repository mutation, deployment, provider, or other component boundaries. Do not use for simple isolated documentation-only changes.
---

# Implementation strategy

Use this Skill before editing for changes where a local fix could create correctness or recovery problems at adjacent runtime boundaries.

## Trigger examples

Use it for changes involving authentication, authorisation, secrets, repository writes, persistence, migrations, durable Workflow state, concurrency, idempotency, retry, cancellation, stale state, GitHub integration, Cloudflare runtime/deployment, provider APIs, Codex Runner, or multiple major components.

Do not invoke it merely because a Skill exists. Simple isolated changes with an obvious local contract do not need a separate strategy pass.

## Procedure

1. Read the complete task or issue, applicable `AGENTS.md` files, and `ARCHITECTURE.md`.
2. Read the relevant current specification and the implementation/tests around the affected path.
3. Identify the current end-to-end path from user or caller input through every affected state, trust, persistence, and external-system boundary.
4. Record the invariants that must remain true and the observable acceptance criteria that prove the change.
5. Identify failure and recovery sequences, including denied input, invalid state, interruption, retry, cancellation, replay, stale observations, concurrency, and ambiguous external outcomes where relevant.
6. Identify existing mechanisms that should be reused rather than replaced: validation, repositories, state transitions, idempotency keys, adapters, configuration, diagnostics, and tests.
7. Verify material external API or platform assumptions against current authoritative documentation when the task depends on them. Do not implement against guessed or private interfaces.
8. Choose the smallest implementation approach compatible with the current architecture and issue scope.
9. Identify the behavioral tests and specification changes required to prove the chosen approach.
10. Then implement within the task scope; do not create an additional design document unless the task explicitly requires one.

## Output discipline

- Keep the strategy proportional to risk.
- Distinguish confirmed repository facts from external assumptions or unresolved uncertainty.
- Prefer one coherent fix that covers the affected runtime boundary over serial symptom patches.
- Do not expand the product requirement while solving an implementation problem.
- If the root cause is not established, diagnose first or add bounded safe instrumentation rather than implementing a speculative broad fix.