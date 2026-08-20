# Specification instructions

These instructions apply to files under `specs/` in addition to the repository-wide guidance.

- Describe current product behaviour, direction, and stable invariants.
- Prefer short bullet-point sentences.
- Describe what must remain true if the implementation is replaced.
- Avoid implementation details better represented by code or operational documentation.
- Avoid exact algorithms, storage mechanisms, internal state machines, retries, timeouts, dependency versions, protocol payloads, and build details unless they form an external product contract.
- Link to contracts or operational documentation rather than duplicating them.
- Split specifications only for genuinely separate product domains.
- Keep roadmap ideas and historical implementation decisions outside current-state specifications.
