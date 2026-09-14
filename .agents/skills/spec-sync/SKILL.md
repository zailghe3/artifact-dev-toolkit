---
name: spec-sync
description: Synchronize ADT current-state specifications and affected durable documentation after implementation changes product behaviour, stable invariants, architecture or trust boundaries, component/operator contracts, or delivery responsibilities. Do not use for internal changes whose documented contracts remain unchanged.
---

# Specification synchronization

Use after implementation when a durable documented contract may have changed.

## Procedure

1. Read the final implementation diff and applicable documentation instructions.
2. Decide whether the change affects a durable contract: observable behaviour, stable product invariant, important limitation, source-of-truth/state/trust boundary, component/operator responsibility, or delivery boundary. If not, make no documentation change.
3. Update only the owning documentation: product behaviour in `specs/`, major system boundaries in `ARCHITECTURE.md`, and operational/component contracts in their owning README or `docs/` guide.
4. Describe what must remain true if the implementation is replaced. Keep exact algorithms, storage mechanics, protocol fields, retries/timeouts, versions, path matrices, build mechanics, and other source-owned detail out unless externally contractual.
5. Reconcile affected documents into one current state. Prefer deleting or replacing stale/duplicated detail over appending explanation; remove obsolete implementation or incident history.
6. Inspect the final documentation diff for correctness, concision, ownership, and contradictions with the implemented behaviour.

Link to authoritative source, configuration, contracts, or operational documentation instead of duplicating their mechanics.
