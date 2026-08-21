---
name: spec-sync
description: Synchronize ADT current-state specifications after implemented product behavior or stable product invariants change. Use when functional implementation changes what users can observe or what must remain true; do not use for implementation-only refactors with unchanged product behavior.
---

# Specification synchronization

Use this Skill after implementation when product behaviour or a stable product invariant has changed.

## Procedure

1. Read the issue or task, the final implementation diff, and `specs/AGENTS.md`.
2. Identify which current-state specification owns the changed behaviour. Do not update unrelated specifications.
3. Determine whether the implementation actually changes observable product behaviour, a durable domain concept, a safety/security invariant, an important product limitation, or a durable architectural boundary represented in the specification.
4. If none of those changed, leave the specification unchanged.
5. If an update is required, describe what must remain true if the implementation is replaced.
6. Remove or revise superseded statements so the specification describes one coherent current state.
7. Link to external contracts or operational/component documentation rather than copying their mechanics into the specification.
8. Keep implementation algorithms, storage mechanisms, internal state machines, exact retries/timeouts, dependency versions, protocol payloads, and build details out unless they form an external product contract.
9. Keep roadmap ideas and historical implementation decisions outside current-state specifications.
10. Inspect the resulting diff for concise wording, correct scope, and consistency with the implemented behavior and acceptance criteria.

## Domain guidance

- Artifact Library, access, lifecycle, catalogue, interface, and broad application invariants normally belong in `specs/000-current-application-spec.md`.
- Agents, Workflows, Runs, providers, durable execution, retries, cancellation, and Codex Runner product behaviour normally belong in `specs/agent-workflows.md`.
- Repository layout and metadata belong in the external artifact repository contract rather than being duplicated in a product specification.
- Operator configuration and implementation mechanics belong in operational/component documentation, source, tests, schemas, or configuration.