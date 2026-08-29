# Repository instructions

These instructions apply to Codex and other coding agents working in this repository.

## Repository map

- Use [`ARCHITECTURE.md`](ARCHITECTURE.md) as the system map for major domains, sources of truth, persistence, trust boundaries, and external-system relationships.
- Read `ARCHITECTURE.md` before implementation that crosses major components, persistence boundaries, trust boundaries, or external systems.
- Product behaviour and stable product invariants live under `specs/`; specification-writing rules live in `specs/AGENTS.md`.
- Repeatable Codex procedures live under `.agents/skills/` and should be loaded only when their trigger applies.
- Human delivery process and operational guidance live under `docs/`; Codex Runner operations live in `codex-runner/README.md`.
- Exact implementation mechanics remain authoritative in source, tests, schemas, migrations, configuration, and workflows.

## Mandatory skill usage

- Use `$feature-request-creation` when asked to create, submit, formalise, re-baseline, or promote one or more canonical ADT feature requests before implementation.
- Use `$implementation-strategy` before editing when implementation crosses authentication, authorisation, secrets, repository mutation, persistence, migrations, durable Workflow state, concurrency, idempotency, retry/cancellation, stale state, GitHub integration, Cloudflare runtime/deployment, provider APIs, Codex Runner, or multiple major components.
- Use `$code-change-verification` after functional code, test, executable configuration, build, or workflow changes and before reporting an implementation or correction pull request complete.
- Use `$spec-sync` when implemented product behaviour or a stable product invariant changes; apply it before final verification.
- Do not invoke a Skill merely because it exists. Follow its stated trigger and boundaries.

## Scope and sources of truth

- Treat the current task or GitHub issue as the scope boundary.
- Read applicable `AGENTS.md` files before editing.
- Prefer authoritative repository sources over duplicated documentation.
- Use `.nvmrc`, `package.json`, and repository scripts for the current toolchain and validation commands.
- Respect documented compatibility holds and maintenance decisions.
- Do not add unrelated dependency, framework, runtime, compiler, deployment-tool, or GitHub Actions upgrades.

## Implementation

- Follow existing repository patterns unless the task explicitly changes them.
- Reuse existing configuration, constants, helpers, components, and abstractions where appropriate.
- Avoid duplicated configuration, unexplained literals, hidden behaviour, and unnecessary abstractions.
- Keep changes focused and remove obsolete in-scope code or configuration made redundant by the change.
- Preserve explicit contracts, deterministic behaviour, least privilege, secure defaults, and clear failure modes.
- Do not weaken tests, linting, type checking, build validation, workflow security, deployment checks, or security controls merely to make a change pass.

## Testing

- Prefer tests of observable behaviour, stable contracts, security invariants, and externally meaningful state transitions over tests of implementation text or structure.
- When the implementation can be replaced without changing required behaviour, the corresponding behavioural tests should normally continue to pass.
- Avoid asserting exact documentation prose, source-code fragments, helper names, styling tokens, file layout, or control-flow syntax unless that exact representation is itself a contract.
- Before adding a source-inspection test, first use or introduce a behavioural seam such as an exported pure function, rendered component, route/service boundary, or semantic policy validator when practical.
- Do not duplicate an invariant with prose or source assertions once the same invariant is covered at a stronger behavioural or semantic boundary.
- For security-sensitive declarative configuration such as workflow permissions, immutable pins, secrets, schemas, and migrations, exact structural assertions are appropriate when the structure is the enforced boundary.
- When a source-inspection assertion is unavoidable, keep it focused on the durable invariant and avoid incidental wording, step names, or implementation sequencing.

## Dependencies and generated files

- Change dependencies only when required by the task.
- Prefer existing platform capabilities and repository dependencies before adding packages.
- Generate `package-lock.json` with npm; do not hand-edit lockfile internals.
- Use the trusted package-lock repair process when repair is needed; do not bypass it with PR-controlled write credentials.
- When dependencies change and registry access permits, run `npm audit` and `npm audit --omit=dev`; report an unavailable audit as not completed with the reason.
- Do not use forced upgrades, blanket overrides, or validation bypasses to silence dependency issues.
- Produce generated files only through declared repository commands.
- Do not commit incidental validation side effects.

## Security-sensitive changes

For authentication, authorisation, secrets, repository writes, deployment configuration, or other privileged operations:

- enforce authorisation server-side;
- use least-privilege permissions;
- validate inputs and repository targets;
- keep secrets and tokens out of logs, errors, client bundles, and generated artifacts;
- fail safely on ambiguous mutations and stale state;
- cover denied, invalid, failure, and success paths where relevant.

## Documentation

- Prefer short, concise bullet-point sentences.
- Give each document one clear purpose.
- Avoid duplicating information already authoritative elsewhere.
- Link to contracts, configuration, code, or operational documentation instead of restating them.
- Keep implementation detail out of high-level product specifications.
- Preserve historical decision records unless the task explicitly changes them.
- Keep documentation changes proportional to the behaviour or contract being changed.

## Validation and pull requests

- Run the repository checks relevant to the files and behaviour changed.
- Report checks accurately as passed, failed, inapplicable, or not completed because of an environment restriction.
- Inspect the final diff and ensure every tracked change is intentional and in scope.
- For issue-driven work, follow the issue-specific Codex execution contract and include the required closing reference in the pull request.
- Report validation for the final pull-request head, not an earlier commit.

## Review and correction prompts

- When a pull-request review identifies changes that should be made before merge, finish with one complete copy-pasteable correction prompt covering all recommended fixes.
- When no review finding requires a change, explicitly state that no follow-up correction prompt is needed.
- Keep each copy-pasteable Codex prompt in one self-contained block unless the user explicitly asks for separate prompts.
- Never place Markdown fenced code blocks inside a copy-pasteable prompt block because nested fences can break copying.
- Represent commands or code examples inside such prompts as indented or plain text instead of nested fenced blocks.
